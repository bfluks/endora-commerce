'use client';

import { type ComponentConfig, type PuckComponent } from '@puckeditor/core';
import { createColorField, withHideOn } from '@endora-commerce/page-builder-core';
import type { AnnouncementBarProps } from '../schema/component-types.js';
import { resolveColorValue } from '../utils/color-value.js';
import { BUTTON_SPEC_OBJECT_FIELDS } from './Button.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl, useCmsRenderLocalizePath } from './render-context.js';
import { blockLink, blockLinkTarget, carriedBlockLink } from '../utils/link-href.js';

const AnnouncementBarRender: PuckComponent<AnnouncementBarProps> = (props) => {
  const {
    text,
    href = '',
    link: storedLink,
    backgroundColor = '#0f766e',
    textColor = '#ffffff',
  } = props;
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  // Feature 167 — an internal link takes the page language's prefix.
  const localizePath = useCmsRenderLocalizePath();
  // R17 (T212): any kind of link; a URL stored before renders as it always did.
  const link = blockLinkTarget(blockLink(storedLink, href), { assets, ...(mediaBaseUrl !== undefined ? { mediaBaseUrl } : {}), localizePath });

  const inner = <span className="cmsc-pb-announcement__text">{text}</span>;

  return (
    <div
      className="cmsc-pb-announcement"
      style={{ backgroundColor: resolveColorValue(backgroundColor), color: resolveColorValue(textColor) }}
      role="status"
    >
      {link ? (
        <a
          className="cmsc-pb-announcement__link"
          href={link.href}
          {...(link.target ? { target: link.target } : {})}
          {...(link.target === '_blank' ? { rel: 'noopener noreferrer' } : {})}
          style={{ color: resolveColorValue(textColor) }}
        >
          {inner}
        </a>
      ) : (
        inner
      )}
    </div>
  );
};

const announcementBarConfig: ComponentConfig<AnnouncementBarProps> = {
  label: 'Announcement bar',
  fields: {
    text: { type: 'text', label: 'Message' },
    // R17 (T212): the shared link (the admin gives it the page, product, category and file pickers).
    link: { ...BUTTON_SPEC_OBJECT_FIELDS.link, label: 'Link (optional)' },
    backgroundColor: createColorField({ label: 'Background' }),
    textColor: createColorField({ label: 'Text color' }),
  },
  defaultProps: {
    text: 'Free shipping on orders over €500 — shop now',
    // R17 (T216): a new bar takes the brand's primary colour and the text colour on it.
    backgroundColor: 'token:primary',
    textColor: 'token:on-primary',
  },
  // R17 (T212): a URL stored before is carried into `link` when the bar is opened (the render is the same).
  resolveData: ({ props }) => {
    const carried = carriedBlockLink(props);
    return { props: carried ? ({ ...props, ...carried } as unknown as typeof props) : props };
  },
  render: AnnouncementBarRender,
};

export const AnnouncementBar = withHideOn(announcementBarConfig);
