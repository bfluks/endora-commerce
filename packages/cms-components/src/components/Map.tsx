/// <reference path="../types/leaflet.d.ts" />
'use client';

import { useEffect, useRef } from 'react';
import { type ComponentConfig, type PuckComponent } from '@puckeditor/core';
import {
  PB_RESPONSIVE_METADATA,
  resolveResponsiveNumber,
  withHideOn,
} from '@endora-commerce/page-builder-core';
import type { BreakpointTier } from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { MapProps } from '../schema/component-types.js';
import { useViewportBreakpointTier } from '../hooks/use-viewport-breakpoint-tier.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { BUTTON_SPEC_OBJECT_FIELDS } from './Button.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl, useCmsRenderLocalizePath } from './render-context.js';
import { blockLink, blockLinkTarget, type LinkHrefEnv } from '../utils/link-href.js';

/** R17 (T220): the most markers a map takes; the list shows each by its label or position. */
const MAX_MARKERS = 50;

/** A marker summarised in the list: its label, else its position. */
function markerSummary(item: { label?: unknown; lat?: unknown; lng?: unknown } | undefined, index?: number): string {
  const label = typeof item?.label === 'string' ? item.label.trim() : '';
  if (label) return label;
  if (typeof item?.lat === 'number' && typeof item?.lng === 'number') return `${item.lat}, ${item.lng}`;
  return `${(index ?? 0) + 1}`;
}

/**
 * R17 (T212): a marker's popup — its label, and its link (any kind; a URL
 * stored before is a URL link) wrapping it, built as DOM nodes, never HTML.
 */
export function markerPopup(marker: { label?: string; link?: unknown }, env: LinkHrefEnv): HTMLElement | string {
  const label = marker.label ?? '';
  const link = blockLinkTarget(blockLink(marker.link, undefined), env);
  if (!link || typeof document === 'undefined') return label;
  const anchor = document.createElement('a');
  anchor.href = link.href;
  if (link.target) anchor.target = link.target;
  if (link.target === '_blank') anchor.rel = 'noopener noreferrer';
  anchor.textContent = label || link.href;
  return anchor;
}

function ensureLeafletCss(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[data-cmsc-leaflet-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  link.crossOrigin = '';
  link.setAttribute('data-cmsc-leaflet-css', '1');
  document.head.appendChild(link);
}

function googleEmbedUrl(props: MapProps): string | null {
  const key = props.googleApiKey?.trim();
  if (!key) return null;
  const lat = props.centerLat ?? 52.2297;
  const lng = props.centerLng ?? 21.0122;
  const zoom = props.zoom ?? 12;
  return `https://www.google.com/maps/embed/v1/view?key=${encodeURIComponent(key)}&center=${lat},${lng}&zoom=${zoom}`;
}

type LeafletMapHandle = {
  remove: () => void;
  invalidateSize: (opts?: { animate?: boolean }) => void;
};

function LeafletMap({
  centerLat,
  centerLng,
  zoom,
  markers,
  height,
}: {
  centerLat: number;
  centerLng: number;
  zoom: number;
  markers: MapProps['markers'];
  height: number;
}): React.ReactElement {
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  // Feature 167 — an internal link takes the page language's prefix.
  const localizePath = useCmsRenderLocalizePath();
  // Read by the map's effect without re-creating the map when the render context changes.
  const linkEnv = useRef<LinkHrefEnv>({});
  linkEnv.current = { assets, ...(mediaBaseUrl !== undefined ? { mediaBaseUrl } : {}), localizePath };
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMapHandle | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    void (async () => {
      try {
        ensureLeafletCss();
        const leaflet = await import('leaflet');
        if (cancelled) return;

        // Default marker icons break under bundlers without explicit URLs — use circle markers.
        const map = leaflet
          .map(el, {
            scrollWheelZoom: false,
          })
          .setView([centerLat, centerLng], zoom);

        leaflet
          .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
          })
          .addTo(map);

        for (const m of markers ?? []) {
          leaflet
            .circleMarker([m.lat, m.lng], {
              radius: 8,
              color: '#0f766e',
              fillColor: '#14b8a6',
              fillOpacity: 0.9,
              weight: 2,
            })
            .addTo(map)
            .bindPopup(markerPopup(m, linkEnv.current) as never);
        }

        const invalidate = (): void => {
          map.invalidateSize({ animate: false });
        };
        // Layout may settle after paint (editor iframe / flex parents).
        requestAnimationFrame(invalidate);
        window.setTimeout(invalidate, 50);
        window.setTimeout(invalidate, 250);

        resizeObserver = new ResizeObserver(() => invalidate());
        resizeObserver.observe(el.parentElement ?? el);

        mapRef.current = map;
      } catch {
        if (el && !cancelled) {
          el.innerHTML =
            '<p style="padding:12px;color:#64748b">Leaflet not available — install leaflet on storefront</p>';
        }
      }
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [centerLat, centerLng, zoom, markers]);

  useEffect(() => {
    mapRef.current?.invalidateSize({ animate: false });
  }, [height]);

  return <div ref={containerRef} className="cmsc-pb-map__leaflet" />;
}

function MapBody({
  props,
  tier,
  editing,
}: {
  props: MapProps & { puck?: { isEditing?: boolean } };
  tier: BreakpointTier;
  editing: boolean;
}): React.ReactElement {
  const {
    provider = 'leaflet',
    height = 360,
    centerLat = 52.2297,
    centerLng = 21.0122,
    zoom = 12,
    markers = [],
    puck: _puck,
    ...box
  } = props;
  const heightPx = resolveResponsiveNumber(height, tier, 360);
  const embed = provider === 'google' ? googleEmbedUrl(props) : null;

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
      <div className="cmsc-pb-map" style={{ height: `${heightPx}px` }}>
        {provider === 'google' ? (
          embed ? (
            <iframe
              title="Map"
              src={embed}
              className="cmsc-pb-map__iframe"
              style={{ height: '100%' }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : (
            <p className="cmsc:text-sm cmsc:text-[#64748b] cmsc:p-3">
              {editing ? 'Enter Google Maps API key for embed' : 'Map unavailable'}
            </p>
          )
        ) : (
          <LeafletMap
            centerLat={centerLat}
            centerLng={centerLng}
            zoom={zoom}
            markers={markers}
            height={heightPx}
          />
        )}
      </div>
    </BoxStyled>
  );
}

const MapEditingRender: PuckComponent<MapProps> = (props) => (
  <MapBody props={props} tier={usePreviewBreakpointTier()} editing />
);

const MapPublishedRender: PuckComponent<MapProps> = (props) => (
  <MapBody props={props} tier={useViewportBreakpointTier()} editing={false} />
);

const MAP_FIELDS = {
  provider: {
    type: 'select' as const,
    label: 'Provider',
    options: [
      { label: 'Leaflet + OpenStreetMap', value: 'leaflet' },
      { label: 'Google Maps (embed)', value: 'google' },
    ],
  },
  googleApiKey: { type: 'text' as const, label: 'Google API key (embed)' },
  height: {
    type: 'number' as const,
    label: 'Height (px)',
    min: 200,
    max: 800,
    metadata: PB_RESPONSIVE_METADATA,
  },
  centerLat: { type: 'number' as const, label: 'Center latitude' },
  centerLng: { type: 'number' as const, label: 'Center longitude' },
  zoom: { type: 'number' as const, label: 'Zoom', min: 1, max: 18 },
  markers: {
    type: 'array' as const,
    label: 'Markers',
    max: MAX_MARKERS,
    getItemSummary: markerSummary,
    arrayFields: {
      label: { type: 'text' as const, label: 'Label' },
      lat: { type: 'number' as const, label: 'Latitude' },
      lng: { type: 'number' as const, label: 'Longitude' },
      // R17 (T212): the shared link (the admin gives it the page, product, category and file pickers).
      link: { ...BUTTON_SPEC_OBJECT_FIELDS.link, label: 'Link (optional)' },
    },
    defaultItemProps: { lat: 52.23, lng: 21.01, label: '' },
  },
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

const mapConfig: ComponentConfig<MapProps> = {
  label: 'Map',
  fields: MAP_FIELDS,
  defaultProps: {
    provider: 'leaflet',
    height: 360,
    centerLat: 52.2297,
    centerLng: 21.0122,
    zoom: 12,
    googleApiKey: '',
    markers: [],
    ...DEFAULT_BOX_PROPS,
  },
  // Filters the host's field set, so the admin's link picker survives.
  resolveFields: (data, params) => {
    const fields = { ...((params?.fields as typeof MAP_FIELDS | undefined) ?? MAP_FIELDS) } as Record<string, unknown>;
    if (data.props.provider !== 'google') delete fields['googleApiKey'];
    return fields as typeof MAP_FIELDS;
  },
  // R17 (T212): a marker's URL stored before is carried into its link when the map is opened.
  resolveData: ({ props }) => {
    const markers = props.markers ?? [];
    if (!markers.some((marker) => typeof marker?.link === 'string')) return { props };
    const carried = markers.map((marker) => (typeof marker?.link === 'string' ? { ...marker, link: blockLink(marker.link, undefined) } : marker));
    return { props: { ...props, markers: carried } as never };
  },
  render: (props) =>
    props.puck?.isEditing ? <MapEditingRender {...props} /> : <MapPublishedRender {...props} />,
};

export const Map = withHideOn(mapConfig);
