import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces.js';
import {
  CORE_BLOCK_NAMES,
  ERROR_CODES,
  ITEMS_TABLE_BLOCK_NAME,
  isValidSectionPartition,
  type DocumentItem,
  type DocumentItemSection,
  type DocumentValue,
  type CoreBlockName,
  type DocumentBlockRenderer,
  type DocumentRenderContext,
  type DocumentRenderInput,
  type DocumentRenderPort,
  type DocumentRenderResult,
  type DocumentTemplateChoices,
  type DocumentTypeRegistration,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import type { CollectionCatalogue, DocumentTypeRegistry } from '../registry/document-type-registry.js';
import type { BlockDeclarations } from '../services/block-declarations.js';
import type { LayoutCandidate, TemplateResolver } from '../services/template-resolver.js';
import { CORE_BLOCK_RENDERERS } from './core-blocks.js';
import { collectImageAssetIds, loadAssetImages, type AssetBytesReader } from './embed-asset-images.js';
import { numberItems, renderItemsTable } from './items-table.js';
import { interpolateMergeFields, type MergeFieldValues } from './merge-fields.js';
import { resolveRootProps, usableWidth } from './page.js';
import { pdfBytes } from './pdfmake.js';

/**
 * The Page Builder → pdfmake engine — the implementation of
 * `documentRenderPort` (`specs/152-compare-pdf-template/contracts/document-type-registry.md` §4).
 *
 * A host hands over its own data, built under its requester's context; the
 * engine chooses the layout (`TemplateResolver`), keeps of it only the blocks
 * the document type offers whose owner is present, runs the type's per-render
 * preparation once, renders each block, and lays the result out on the page
 * the type and the template describe. It never reads a host's data and never
 * fetches anything: images are assets-library bytes inlined before pdfmake
 * runs, and pdfmake's URL policy denies all.
 *
 * **Failure policy** (research R-17): a block's `render` throwing fails the
 * document with `DOCUMENT_RENDER_FAILED`, logged with the template, its version
 * and the block; a `ModuleDisabledError` is re-thrown untouched. A type whose
 * document must never fail on an enrichment absorbs that in its own
 * `prepareRender` (invoices' contributed blocks).
 */

const CORE = new Set<string>(CORE_BLOCK_NAMES);

export interface DocumentRendererDeps {
  readonly registry: DocumentTypeRegistry;
  readonly resolver: TemplateResolver;
  readonly declarations: BlockDeclarations;
  readonly assets: AssetBytesReader;
  readonly now?: () => Date;
  readonly log?: (message: string, context: Record<string, unknown>) => void;
}

/** What a definition was built from — the metadata half of a render result. */
export interface BuiltDocument {
  readonly definition: TDocumentDefinitions;
  readonly source: DocumentRenderResult['source'];
  readonly templateId: string | null;
  readonly templateVersion: number | null;
  readonly language: string;
  readonly requestedTemplateMissing: boolean;
}

interface PlacedNode {
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a type's data shape is the host's.
type AnyRegistration = DocumentTypeRegistration<any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above.
type AnyBlock = DocumentBlockRenderer<any, any>;

function nodesOf(tree: unknown): PlacedNode[] {
  const content = (tree as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return [];
  const out: PlacedNode[] = [];
  for (const node of content as { type?: unknown; props?: unknown }[]) {
    if (typeof node?.type !== 'string') continue;
    const props =
      node.props && typeof node.props === 'object' && !Array.isArray(node.props)
        ? (node.props as Record<string, unknown>)
        : {};
    out.push({ type: node.type, props });
  }
  return out;
}

function rootPropsOf(tree: unknown): unknown {
  return (tree as { root?: { props?: unknown } } | null)?.root?.props;
}

/** Declared defaults under stored props; a stored `undefined` does not shadow a default. */
function mergeDefaults(
  defaults: Readonly<Record<string, unknown>>,
  stored: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(stored)) {
    if (value !== undefined || !(key in defaults)) merged[key] = value;
  }
  return merged;
}

export class DocumentRenderer implements DocumentRenderPort {
  private readonly now: () => Date;
  private readonly log: (message: string, context: Record<string, unknown>) => void;

  constructor(private readonly deps: DocumentRendererDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? ((message, context) => console.error(message, context));
  }

  async render<TData>(input: DocumentRenderInput<TData>): Promise<DocumentRenderResult> {
    const built = await this.buildDefinition(input);
    let bytes: Uint8Array;
    try {
      bytes = await pdfBytes(built.definition);
    } catch (error) {
      rethrowIfModuleDisabled(error);
      this.log('[document_templates] pdfmake could not produce the document', {
        documentType: input.documentType,
        templateId: built.templateId,
        templateVersion: built.templateVersion,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpError(503, ERROR_CODES.DOCUMENT_RENDER_FAILED, 'The document could not be produced.');
    }
    const { definition: _definition, ...meta } = built;
    return { bytes, ...meta };
  }

  /**
   * The templates a person may pick for one document (feature 153, contract
   * §5) — answered from the facility's own table, so a host can offer a picker
   * to people who may not manage templates.
   */
  async listChoices(input: {
    readonly documentType: string;
    readonly salesChannelId: string | null;
  }): Promise<DocumentTemplateChoices> {
    const registration = this.deps.registry.get(input.documentType);
    if (!registration) {
      throw new HttpError(404, ERROR_CODES.DOCUMENT_TYPE_NOT_AVAILABLE, 'This document type is not available.', {
        documentType: input.documentType,
      });
    }
    if (registration.selection !== 'per_document') {
      throw new HttpError(
        422,
        ERROR_CODES.DOCUMENT_TEMPLATE_NOT_SELECTABLE,
        'This document type does not allow choosing a template for a single document.',
        { documentType: input.documentType },
      );
    }
    return this.deps.resolver.listChoices({
      documentType: input.documentType,
      salesChannelId: input.salesChannelId,
      builtIn: registration.defaultContent(),
    });
  }

  /**
   * The pdfmake document definition of a document, without producing bytes —
   * what every test of the engine asserts on, because a definition can be
   * compared and a PDF cannot.
   */
  async buildDefinition<TData>(input: DocumentRenderInput<TData>): Promise<BuiltDocument> {
    const registration = this.deps.registry.get(input.documentType);
    if (!registration) {
      throw new HttpError(404, ERROR_CODES.DOCUMENT_TYPE_NOT_AVAILABLE, 'This document type is not available.', {
        documentType: input.documentType,
      });
    }

    const preview = input.preview === true || input.tree !== undefined;
    const blocks = new Map<string, AnyBlock>(
      this.deps.registry.blocks(input.documentType).map((block) => [block.name, block]),
    );
    const core = new Set<string>(this.deps.registry.coreBlocks(input.documentType));
    const dataBlocks = new Set<string>(this.deps.registry.collectionBlocks(input.documentType));
    const renderable = (node: PlacedNode): boolean =>
      blocks.has(node.type) || core.has(node.type) || dataBlocks.has(node.type);

    let candidates: readonly (LayoutCandidate | { source: 'canvas'; templateId: null; templateVersion: null; language: string; tree: unknown })[];
    let requestedTemplateMissing = false;
    if (input.tree !== undefined) {
      // The admin preview of an unsaved canvas: the canvas, and when it places
      // nothing printable, what a document of this type falls back to.
      candidates = [
        { source: 'canvas', templateId: null, templateVersion: null, language: input.language, tree: input.tree },
        ...(registration.renderBuiltIn
          ? []
          : (
              await this.deps.resolver.resolve({
                documentType: input.documentType,
                salesChannelId: null,
                language: input.language,
                selection: 'default_only',
                builtIn: registration.defaultContent(),
              })
            ).candidates.filter((candidate) => candidate.source === 'built_in')),
      ];
    } else {
      const resolved = await this.deps.resolver.resolve({
        documentType: input.documentType,
        salesChannelId: input.salesChannelId,
        language: input.language,
        selection: registration.selection,
        builtIn: registration.defaultContent(),
        ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
      });
      candidates = resolved.candidates;
      requestedTemplateMissing = resolved.requestedTemplateMissing;
    }

    const chosen = candidates.find((candidate) => nodesOf(candidate.tree).some(renderable)) ?? null;
    const placed = chosen ? nodesOf(chosen.tree).filter(renderable) : null;
    const language = chosen?.language ?? input.language;

    const root = resolveRootProps(chosen ? rootPropsOf(chosen.tree) : undefined, registration.pageDefaults);
    const orientation =
      root.orientation === 'auto'
        ? (registration.suggestOrientation?.(input.data) ?? 'portrait')
        : root.orientation;
    const context: DocumentRenderContext = {
      documentType: input.documentType,
      language,
      salesChannelId: input.salesChannelId,
      preview,
      pageWidth: usableWidth(root, orientation),
    };

    const prepared = registration.prepareRender
      ? await registration.prepareRender(input.data, {
          placedBlocks: placed ? new Set(placed.map((node) => node.type)) : null,
          preview,
        })
      : undefined;

    const variables: MergeFieldValues = {
      date: new Intl.DateTimeFormat(language, { dateStyle: 'long' }).format(this.now()),
      ...(registration.resolveVariables?.(input.data, context) ?? {}),
    };
    const interpolate = (text: string): string => interpolateMergeFields(text, variables);

    let content: Content[];
    if (placed) {
      // Feature 153 — the catalogue of every collection a Line items table
      // uses, loaded once per render beside the images (contract §3.2).
      const firstCollection = registration.collections?.[0]?.key ?? '';
      const collectionOf = (props: Readonly<Record<string, unknown>>): string =>
        typeof props['collection'] === 'string' && props['collection'] !== '' ? props['collection'] : firstCollection;
      const tableKeys = [
        ...new Set(placed.filter((node) => node.type === ITEMS_TABLE_BLOCK_NAME).map((node) => collectionOf(node.props))),
      ];
      const [images, catalogues] = await Promise.all([
        loadAssetImages(
          collectImageAssetIds({ content: placed.filter((node) => node.type === 'document_templates.Image') }),
          this.deps.assets,
        ),
        Promise.all(
          tableKeys.map(
            async (key) => [key, await this.deps.registry.catalogue(input.documentType, key, language)] as const,
          ),
        ).then((entries) => new Map<string, CollectionCatalogue>(entries)),
      ]);
      // `items()`, `summary()` and `sections()` once per collection per
      // render; a throw from the first two is the block's failure, so they are
      // read inside `renderBlock`. Sections never fail a document (feature 159).
      const lines = new Map<
        string,
        {
          items: DocumentItem[];
          summary: Readonly<Record<string, DocumentValue>>;
          sections?: readonly DocumentItemSection[];
        }
      >();
      const linesOf = (key: string) => {
        let found = lines.get(key);
        if (!found) {
          const collection = registration.collections?.find((candidate) => candidate.key === key);
          if (collection) {
            const items = numberItems(collection.items(input.data));
            const summary = collection.summary?.(input.data) ?? {};
            const sections = this.sectionsOf(registration.code, collection, input.data, items.length);
            found = { items, summary, ...(sections ? { sections } : {}) };
          } else {
            found = { items: [], summary: {} };
          }
          lines.set(key, found);
        }
        return found;
      };
      content = [];
      for (const node of placed) {
        const props = mergeDefaults(this.deps.declarations.defaultProps(node.type), node.props);
        content.push(
          await this.renderBlock(registration, node.type, chosen, () =>
            node.type === ITEMS_TABLE_BLOCK_NAME
              ? renderItemsTable({
                  props,
                  catalogue: catalogues.get(collectionOf(props)) ?? { fields: [], summaryFields: [] },
                  ...linesOf(collectionOf(props)),
                  language,
                  context,
                  interpolate,
                })
              : CORE.has(node.type)
              ? CORE_BLOCK_RENDERERS[node.type as CoreBlockName]({ props, interpolate, images, context })
              : blocks.get(node.type)!.render({
                  props,
                  data: input.data,
                  prepared,
                  language,
                  context,
                  interpolate,
                }),
          ),
        );
      }
    } else if (registration.renderBuiltIn) {
      const builtIn = registration.renderBuiltIn;
      content = (await this.renderBlock(registration, '<built-in>', null, () =>
        builtIn(input.data, prepared, context),
      )) as Content[];
    } else {
      this.log('[document_templates] no layout of this document type places anything printable', {
        documentType: input.documentType,
      });
      throw new HttpError(503, ERROR_CODES.DOCUMENT_RENDER_FAILED, 'The document has nothing to print.', {
        documentType: input.documentType,
      });
    }

    const definition: TDocumentDefinitions = {
      pageSize: root.pageSize,
      ...(orientation === 'landscape' ? { pageOrientation: 'landscape' as const } : {}),
      pageMargins: [root.marginLeft, root.marginTop, root.marginRight, root.marginBottom],
      defaultStyle: { fontSize: root.baseFontSize, font: 'Roboto' },
      ...(registration.pageDefaults?.styles
        ? { styles: structuredClone(registration.pageDefaults.styles) as TDocumentDefinitions['styles'] }
        : {}),
      content,
      ...this.headerAndFooter(root, variables),
    };

    return {
      definition,
      source: chosen ? chosen.source : 'built_in',
      templateId: chosen?.templateId ?? null,
      templateVersion: chosen?.templateVersion ?? null,
      language,
      requestedTemplateMissing,
    };
  }

  /**
   * Feature 159 — a collection's sections, checked once per render
   * (`specs/159-quote-request-item-groups/contracts/document-sections.md` §1).
   * A host that throws, or answers a partition that does not cover its lines,
   * is logged once and its tables print flat: the document never fails for it.
   */
  private sectionsOf<TData>(
    documentType: string,
    collection: NonNullable<AnyRegistration['collections']>[number],
    data: TData,
    itemCount: number,
  ): readonly DocumentItemSection[] | undefined {
    if (!collection.sections) return undefined;
    let sections: readonly DocumentItemSection[];
    try {
      sections = collection.sections(data);
    } catch (error) {
      rethrowIfModuleDisabled(error);
      this.log('[document_templates] a collection’s sections could not be read; the table prints flat', {
        documentType,
        collection: collection.key,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
    if (!isValidSectionPartition(sections, itemCount)) {
      this.log('[document_templates] a collection’s sections do not partition its lines; the table prints flat', {
        documentType,
        collection: collection.key,
        sectionCount: sections.length,
        itemCount,
      });
      return undefined;
    }
    return sections;
  }

  private async renderBlock(
    registration: AnyRegistration,
    blockName: string,
    candidate: { templateId: string | null; templateVersion: number | null } | null,
    render: () => unknown,
  ): Promise<Content> {
    try {
      return (await render()) as Content;
    } catch (error) {
      rethrowIfModuleDisabled(error);
      this.log('[document_templates] a block failed to render', {
        documentType: registration.code,
        templateId: candidate?.templateId ?? null,
        templateVersion: candidate?.templateVersion ?? null,
        blockName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpError(503, ERROR_CODES.DOCUMENT_RENDER_FAILED, 'The document could not be produced.', {
        documentType: registration.code,
        blockName,
      });
    }
  }

  /** Repeating header and footer — only when they have something to say. */
  private headerAndFooter(
    root: ReturnType<typeof resolveRootProps>,
    variables: MergeFieldValues,
  ): Partial<Pick<TDocumentDefinitions, 'header' | 'footer'>> {
    const fontSize = Math.max(6, root.baseFontSize - 2);
    const margin: [number, number, number, number] = [root.marginLeft, 12, root.marginRight, 0];
    const text = (template: string, page: number, pages: number): string =>
      interpolateMergeFields(template, { ...variables, page: String(page), pages: String(pages) });
    const out: Partial<Pick<TDocumentDefinitions, 'header' | 'footer'>> = {};
    if (root.headerText.trim() !== '') {
      const headerText = root.headerText;
      out.header = (page: number, pages: number): Content => ({
        text: text(headerText, page, pages),
        fontSize,
        color: '#475569',
        margin,
      });
    }
    if (root.footerText.trim() !== '' || root.showPageNumbers) {
      const footerText = root.footerText;
      const numbers = root.showPageNumbers ? root.pageNumberFormat : '';
      out.footer = (page: number, pages: number): Content => ({
        columns: [
          { text: footerText.trim() === '' ? '' : text(footerText, page, pages), width: '*' },
          { text: numbers === '' ? '' : text(numbers, page, pages), width: 'auto', alignment: 'right' },
        ],
        fontSize,
        color: '#475569',
        margin,
      });
    }
    return out;
  }
}
