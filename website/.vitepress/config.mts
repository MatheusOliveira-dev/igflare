import { readFileSync } from 'node:fs';
import { defineConfig, type DefaultTheme } from 'vitepress';

const repo = 'https://github.com/MatheusOliveira-dev/igflare';
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
  description:
    "A TypeScript client for Instagram's mobile private API, with typed results and typed errors.",
  base: '/igflare/',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/igflare/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#f4613a' }],
    ['meta', { property: 'og:title', content: 'igflare' }],
    [
      'meta',
      {
        property: 'og:description',
        content: "A TypeScript client for Instagram's mobile private API.",
      },
    ],
  ],
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
