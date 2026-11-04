'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';
import { type ComponentConfig, type PuckComponent } from '@puckeditor/core';
import {
  createAspectRatioField,
  createToggleField,
  PB_RESPONSIVE_METADATA,
  resolveResponsive,
  resolveResponsiveNumber,
  withHideOn,
  type Responsive,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { BreakpointTier } from '@endora-commerce/page-builder-core';
import type { VideoProps } from '../schema/component-types.js';
import { useViewportBreakpointTier } from '../hooks/use-viewport-breakpoint-tier.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  CORNER_RADIUS_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { buildVideoEmbedUrl } from '../utils/video-embed.js';
import { ratioPadding, ratioVars, sanitizeRatio, uniformRatio } from '../utils/aspect-ratio.js';
import { absolutizeMediaUrl } from '../utils/resolve-image-url.js';
import { impliedMediaSource, pickBySource, type MediaSource } from '../utils/media-source.js';
import { DEFAULT_MEDIA_CORNER_RADIUS, mediaRadiusPx, mediaRadiusVars } from '../utils/media-radius.js';
import { useBreakpointVideo } from '../hooks/use-breakpoint-video.js';
import { useCmsRenderMediaBaseUrl } from './render-context.js';
import { useAssetUrl } from './section-parts.js';

/**
 * `cms.Video` — an embedded player (YouTube, Vimeo, any HTTPS iframe), as on
 * `origin/master`, or a self-hosted file
 * (`specs/163-page-builder-marketing-pages/` T126, research R-9, FR-012).
 *
 * A stored video with no `source` is an embed and renders today's markup. The
 * aspect ratio takes any aspect token, per breakpoint: one ratio keeps today's
 * padded frame, a ratio that changes with the breakpoint writes `--pb-ratio*`
 * on `.cmsc-pb-video__frame`.
 *
 * A file is a library video (or a direct file URL), an optional video for
 * below the tablet tier (a library video or, T142, a URL) and a poster, with
 * an optional poster of its own for the mobile video (T162, a library image or
 * a URL; one video with its own mobile poster renders once per breakpoint). Its frame reserves the ratio before
 * anything loads; each video is `preload="none"`, inline, and never carries
 * `autoplay`. An autoplaying file is muted and is started by
 * `useBreakpointVideo` only once on screen and never under reduced motion; the
 * one for the other breakpoint stays paused and hidden by CSS. Otherwise the
 * visitor starts it with its controls.
 *
 * T194: a file and its mobile file follow a file source (the library or
 * URLs), the poster and the mobile poster a poster source (`posterUrl` is
 * new); the chosen source wins and the other is the fallback, and unset reads
 * as the library, so a stored file plays and shows what it did. The editor
 * offers the fields of the chosen sources only, and records the source a
 * stored file's values imply ({@link impliedMediaSource}).
 *
 * R6 (T140): the frame's corners are an option (`mediaCornerRadius`, today's
 * 8 px by default) reaching the file frame, the embed's frame and its iframe.
 * The box's own `cornerRadius` stays the box's: it never reached the frame.
 */

const DEFAULT_RATIO = '16:9';

const SOURCE_OPTIONS = [
  { label: 'Asset library', value: 'library' },
  { label: 'URL', value: 'url' },
];

/** T194: the fields each source offers (a file's `url` is also the embed's, so it stays for an embed). */
const FILE_SOURCE_FIELDS = { library: ['videoAssetId', 'mobileVideoAssetId'], url: ['url', 'mobileUrl'] } as const;
const POSTER_SOURCE_FIELDS = { library: ['posterAssetId', 'mobilePosterAssetId'], url: ['posterUrl', 'mobilePosterUrl'] } as const;

function fileSourceOf(props: VideoProps): MediaSource {
  return impliedMediaSource(props.fileSource, [props.url, props.mobileUrl], [props.videoAssetId, props.mobileVideoAssetId]);
}

function posterSourceOf(props: VideoProps): MediaSource {
  return impliedMediaSource(props.posterSource, [props.posterUrl, props.mobilePosterUrl], [props.posterAssetId, props.mobilePosterAssetId]);
}

function alignClass(align: VideoProps['align'], tier: BreakpointTier): string {
  const value = resolveResponsive(align, tier, 'center');
  if (value === 'left') return 'cmsc:mr-auto';
  if (value === 'right') return 'cmsc:ml-auto';
  return 'cmsc:mx-auto';
}

function VideoFile({
  props,
  ratio,
  editing,
}: {
  props: VideoProps;
  ratio: Responsive<string>;
  editing: boolean;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const assetUrl = useAssetUrl();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  const autoplay = props.autoplay === true;
  // Only an autoplaying file is started by the effect; the visitor starts any other one.
  useBreakpointVideo(ref, 'video[data-bp][data-autoplay]');

  const fromUrl = (url: string | undefined): string => absolutizeMediaUrl(url?.trim() ?? '', mediaBaseUrl);
  // T194: the files follow the file source — its own first, the other as the fallback; unset, the library.
  const desktop = pickBySource(props.fileSource, assetUrl(props.videoAssetId), fromUrl(props.url));
  // T142: a mobile video from the library, or by URL (a CDN or hotlinked file), as the desktop one may be.
  const mobile = pickBySource(props.fileSource, assetUrl(props.mobileVideoAssetId), fromUrl(props.mobileUrl));
  // T194: the posters follow the poster source the same way.
  const poster = pickBySource(props.posterSource, assetUrl(props.posterAssetId), fromUrl(props.posterUrl));
  // T162: the mobile video's own poster; unset, the poster.
  const mobilePoster = pickBySource(props.posterSource, assetUrl(props.mobilePosterAssetId), fromUrl(props.mobilePosterUrl)) || poster;
  if (!desktop && !mobile && !editing) return null;

  const video = (src: string, breakpoint: 'mobile' | 'desktop' | 'all', still: string): ReactNode => (
    <video
      key={breakpoint}
      className="cmsc-pb-video__file"
      data-bp={breakpoint}
      src={src}
      preload="none"
      playsInline
      aria-label={props.title || undefined}
      {...(still ? { poster: still } : {})}
      {...(autoplay ? { muted: true, 'data-autoplay': '' } : props.muted === true ? { muted: true } : {})}
      {...(props.loop === true ? { loop: true } : {})}
      {...(props.controls !== false ? { controls: true } : {})}
    />
  );

  let videos: ReactNode = null;
  // Two videos, or one with its own mobile poster (each `preload="none"`, so nothing loads twice): a pair.
  if ((desktop && mobile && desktop !== mobile) || ((desktop || mobile) && mobilePoster !== poster)) {
    videos = [video(mobile || desktop, 'mobile', mobilePoster), video(desktop || mobile, 'desktop', poster)];
  } else if (desktop || mobile) videos = video(desktop || mobile, 'all', poster);

  return (
    <div ref={ref} className="cmsc-pb-video__frame cmsc-pb-video__frame--file" style={ratioVars(ratio) as CSSProperties}>
      {videos}
    </div>
  );
}

function VideoEmbed({ props, ratio, editing }: { props: VideoProps; ratio: Responsive<string>; editing: boolean }): ReactNode {
  const { url, provider = 'auto', autoplay = false, muted = false, loop = false, controls = true, title = 'Video' } = props;
  const embedUrl = buildVideoEmbedUrl(url, provider, { autoplay, muted, loop, controls });
  if (!embedUrl) {
    return (
      <p className="cmsc:text-sm cmsc:text-[#64748b]">
        {editing ? 'Enter a valid YouTube, Vimeo, or HTTPS video URL' : null}
      </p>
    );
  }
  // One ratio at every breakpoint: today's padded frame. A ratio per breakpoint: the ratio variables.
  const uniform = uniformRatio(ratio);
  // T140: a chosen corner radius replaces the frame's `rounded-lg` (today's 8 px).
  const radiusPx = mediaRadiusPx(props.mediaCornerRadius);
  const radius = radiusPx === null ? {} : { borderRadius: radiusPx };
  return (
    <div
      className={`cmsc:relative cmsc:w-full cmsc:overflow-hidden cmsc:rounded-lg${uniform === null ? ' cmsc-pb-video__frame' : ''}`}
      style={{ ...(uniform === null ? ratioVars(ratio) : { paddingTop: ratioPadding(uniform) }), ...radius } as CSSProperties}
    >
      <iframe
        src={embedUrl}
        title={title}
        className="cmsc:absolute cmsc:inset-0 cmsc:h-full cmsc:w-full cmsc:border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

function VideoBody({
  props,
  tier,
  editing,
}: {
  props: VideoProps;
  tier: BreakpointTier;
  editing: boolean;
}): React.ReactElement {
  const {
    source = 'embed',
    url: _url,
    provider: _provider,
    aspectRatio,
    autoplay: _autoplay,
    muted: _muted,
    loop: _loop,
    controls: _controls,
    title: _title,
    fileSource: _fileSource,
    videoAssetId: _videoAssetId,
    mobileVideoAssetId: _mobileVideoAssetId,
    mobileUrl: _mobileUrl,
    posterSource: _posterSource,
    posterAssetId: _posterAssetId,
    posterUrl: _posterUrl,
    mobilePosterAssetId: _mobilePosterAssetId,
    mobilePosterUrl: _mobilePosterUrl,
    align,
    maxWidth,
    mediaCornerRadius,
    puck: _puck,
    ...box
  } = props as VideoProps & { puck?: unknown };
  const maxW = resolveResponsiveNumber(maxWidth, tier, 100);
  const ratio = sanitizeRatio(aspectRatio as Responsive<string> | undefined, DEFAULT_RATIO, false) ?? DEFAULT_RATIO;

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
      <div
        className={`cmsc-pb-video cmsc:w-full ${alignClass(align, tier)}`}
        style={{ maxWidth: maxW === 100 ? undefined : `${maxW}%`, ...mediaRadiusVars(mediaCornerRadius) }}
      >
        {source === 'file' ? (
          <VideoFile props={props} ratio={ratio} editing={editing} />
        ) : (
          <VideoEmbed props={props} ratio={ratio} editing={editing} />
        )}
      </div>
    </BoxStyled>
  );
}

const VideoEditingRender: PuckComponent<VideoProps> = (props) => {
  const tier = usePreviewBreakpointTier();
  return <VideoBody props={props} tier={tier} editing />;
};

const VideoPublishedRender: PuckComponent<VideoProps> = (props) => {
  const tier = useViewportBreakpointTier();
  return <VideoBody props={props} tier={tier} editing={false} />;
};

const videoConfig: ComponentConfig<VideoProps> = {
  label: 'Video',
  fields: {
    source: {
      type: 'select',
      label: 'Source',
      options: [
        { label: 'Embed (YouTube, Vimeo, page URL)', value: 'embed' },
        { label: 'Video file', value: 'file' },
      ],
    },
    // T194: a file's source — the library videos or their URLs.
    fileSource: { type: 'select', label: 'File source', options: SOURCE_OPTIONS },
    url: { type: 'text', label: 'Video URL' },
    provider: {
      type: 'select',
      label: 'Provider',
      options: [
        { label: 'Auto-detect', value: 'auto' },
        { label: 'YouTube', value: 'youtube' },
        { label: 'Vimeo', value: 'vimeo' },
        { label: 'Generic (HTTPS iframe)', value: 'generic' },
      ],
    },
    // The admin swaps these three for its asset pickers (`PageBuilderEditor`).
    videoAssetId: { type: 'text', label: 'Video file' },
    mobileVideoAssetId: { type: 'text', label: 'Mobile video file' },
    // T142: the mobile video by URL, used when no mobile library video is chosen.
    mobileUrl: { type: 'text', label: 'Mobile video URL' },
    // T194: the posters' source — the library images or their URLs.
    posterSource: { type: 'select', label: 'Poster source', options: SOURCE_OPTIONS },
    posterAssetId: { type: 'text', label: 'Poster image' },
    posterUrl: { type: 'text', label: 'Poster URL' },
    // T162: the mobile video's own poster (the admin swaps the asset id for its picker).
    mobilePosterAssetId: { type: 'text', label: 'Mobile poster image' },
    mobilePosterUrl: { type: 'text', label: 'Mobile poster URL' },
    // R17 (T219): the accessible title with the sources it names.
    title: { type: 'text', label: 'Title (accessibility)' },
    // R17 (T204): switches; the stored booleans are unchanged.
    autoplay: createToggleField({ label: 'Autoplay' }),
    muted: createToggleField({ label: 'Muted' }),
    loop: createToggleField({ label: 'Loop' }),
    controls: createToggleField({ label: 'Controls', defaultValue: true }),
    // T140: the frame's corners, today's 8 px by default. R17 (T210, T219): the block's one corner
    // setting, last on its tab — next to the frame's ratio and width on the Responsive tab.
    mediaCornerRadius: { ...CORNER_RADIUS_FIELD, label: 'Rounded corners' },
    // Today's three values and every other aspect token, per breakpoint (Responsive tab).
    aspectRatio: createAspectRatioField({ label: 'Aspect ratio', defaultRatio: DEFAULT_RATIO, allowAuto: false }),
    // R17 (T209): a percentage of the width the block is given (it is stored as one).
    maxWidth: {
      type: 'number',
      label: 'Max width (% of the available width)',
      min: 25,
      max: 100,
      metadata: PB_RESPONSIVE_METADATA,
    },
    align: {
      type: 'select',
      label: 'Align',
      metadata: PB_RESPONSIVE_METADATA,
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    source: 'embed',
    url: '',
    provider: 'auto',
    aspectRatio: '16:9',
    title: 'Video',
    autoplay: false,
    muted: false,
    loop: false,
    controls: true,
    maxWidth: 100,
    align: 'center',
    mediaCornerRadius: DEFAULT_MEDIA_CORNER_RADIUS,
    ...DEFAULT_BOX_PROPS,
  },
  // An embed offers its URL and provider; a file the fields of its file and poster sources (T194).
  resolveFields: (data, { fields }) => {
    const next: Partial<typeof fields> = { ...fields };
    if (data.props.source === 'file') {
      delete next.provider;
      for (const key of FILE_SOURCE_FIELDS[fileSourceOf(data.props) === 'url' ? 'library' : 'url']) delete next[key];
      for (const key of POSTER_SOURCE_FIELDS[posterSourceOf(data.props) === 'url' ? 'library' : 'url']) delete next[key];
      // R17 (T219): an autoplaying file is always muted, so "Muted" has nothing to change.
      if (data.props.autoplay === true) delete next.muted;
    } else {
      delete next.fileSource;
      delete next.posterSource;
      for (const key of [...FILE_SOURCE_FIELDS.library, 'mobileUrl', ...POSTER_SOURCE_FIELDS.library, ...POSTER_SOURCE_FIELDS.url] as const) delete next[key];
    }
    return next as typeof fields;
  },
  // T194: a file with no source chosen records the ones its values imply — what it already plays and shows.
  resolveData: async (data) => {
    const props = data.props as VideoProps;
    if (props.source !== 'file' || (props.fileSource !== undefined && props.posterSource !== undefined)) return { props: data.props };
    return { props: { ...data.props, fileSource: fileSourceOf(props), posterSource: posterSourceOf(props) } };
  },
  render: (props) =>
    props.puck?.isEditing ? <VideoEditingRender {...props} /> : <VideoPublishedRender {...props} />,
};

export const Video = withHideOn(videoConfig);
