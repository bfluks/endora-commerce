import type { HideOn, ResponsiveProp } from './responsive.js';
import type { PageBuilderEditorProps } from './editor-chrome.js';

export type HideOnProps = PageBuilderEditorProps & {
  hideOn?: HideOn;
  /**
   * The block's place per breakpoint in a flex or grid parent
   * (`specs/163-page-builder-marketing-pages/` T156), one of
   * `STACK_ORDER_VALUES`; read by `withHideOn`, which owns its values.
   */
  stackOrder?: string | ResponsiveProp<string>;
};
