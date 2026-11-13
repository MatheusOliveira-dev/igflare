import { readFileSync } from 'node:fs';
import { defineConfig, type DefaultTheme } from 'vitepress';

const repo = 'https://github.com/MatheusOliveira-dev/igflare';
const site = 'https://matheusoliveira-dev.github.io/igflare';
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

/** The API sidebar is written by the typedoc step; the site still builds without it. */
function apiSidebar(): DefaultTheme.SidebarItem[] {
  try {
    const raw = readFileSync(new URL('../api/typedoc-sidebar.json', import.meta.url), 'utf8');
    return JSON.parse(raw) as DefaultTheme.SidebarItem[];
  } catch {
    return [];
  }
}

const guide: DefaultTheme.SidebarItem[] = [
  {
    text: 'Introduction',
    items: [
      { text: 'What is igflare', link: '/guide/' },
      { text: 'Getting started', link: '/guide/getting-started' },
      { text: 'Migrating from instagram-private-api', link: '/guide/migrating' },
    ],
  },
  {
    text: 'Essentials',
    items: [
      { text: 'Logging in', link: '/guide/authentication' },
      { text: 'Sessions', link: '/guide/sessions' },
      { text: 'Results and errors', link: '/guide/errors' },
      { text: 'Lists and pagination', link: '/guide/pagination' },
    ],
  },
  {
    text: 'Features',
    items: [
      { text: 'Profiles and the follow graph', link: '/guide/users' },
      { text: 'Feeds and posts', link: '/guide/feeds' },
      { text: 'Publishing', link: '/guide/publishing' },
      { text: 'Direct messages', link: '/guide/direct' },
      { text: 'Insights', link: '/guide/insights' },
    ],
  },
  {
    text: 'Going further',
    items: [
      { text: 'Proxies, retries and transports', link: '/guide/network' },
      { text: 'Limitations', link: '/guide/limitations' },
      { text: 'New app builds', link: '/guide/app-builds' },
    ],
  },
];

export default defineConfig({
  title: 'igflare',
  titleTemplate: ':title | igflare, Instagram private API for TypeScript',
  description:
    "A TypeScript client for Instagram's mobile private API, with typed results and typed errors.",
  base: '/igflare/',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: `${site}/` },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/igflare/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#f4613a' }],
    [
      'meta',
      {
        name: 'google-site-verification',
        content: 'd2QQU9iDnq3Jhb7v5rnBlyPby26b_6d_Igm6GckM11c',
      },
    ],
    [
      'meta',
      {
        name: 'keywords',
        content:
          'instagram api, instagram private api, instagram sdk, typescript, node.js, instagram client, instagram insights, instagram direct messages',
      },
    ],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'igflare' }],
    ['meta', { property: 'og:title', content: "igflare: Instagram's private API, typed" }],
    [
      'meta',
      {
        property: 'og:description',
        content: "A TypeScript client for Instagram's mobile private API.",
      },
    ],
    ['meta', { property: 'og:url', content: `${site}/` }],
    ['meta', { property: 'og:image', content: `${site}/og.png` }],
    ['meta', { property: 'og:image:width', content: '1280' }],
    ['meta', { property: 'og:image:height', content: '640' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: `${site}/og.png` }],
  ],
  // One canonical link per page, so the GitHub Pages host and any mirror do not split ranking.
  transformPageData(pageData) {
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
    const head = (pageData.frontmatter['head'] ?? []) as unknown[];
    head.push(['link', { rel: 'canonical', href: `${site}/${path}` }]);
    pageData.frontmatter['head'] = head;
  },
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/', activeMatch: '/guide/' },
      { text: 'API', link: '/api/', activeMatch: '/api/' },
      { text: 'Examples', link: `${repo}/tree/main/examples` },
      {
        text: `v${version}`,
        items: [
          { text: 'Changelog', link: '/changelog' },
          { text: 'npm', link: 'https://www.npmjs.com/package/igflare' },
          { text: 'Security', link: `${repo}/blob/main/SECURITY.md` },
        ],
      },
    ],
    sidebar: {
      '/guide/': guide,
      '/api/': [{ text: 'API reference', link: '/api/', items: apiSidebar() }],
    },
    socialLinks: [{ icon: 'github', link: repo }],
    search: { provider: 'local' },
    editLink: { pattern: `${repo}/edit/main/website/:path`, text: 'Edit this page on GitHub' },
    outline: { level: [2, 3] },
    footer: {
      message: 'MIT License. Not affiliated with, endorsed or sponsored by Meta or Instagram.',
      copyright: 'Copyright 2026 Matheus Oliveira',
    },
  },
});
