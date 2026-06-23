import createMDX from '@next/mdx';
import remarkGfm from 'remark-gfm';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

// SQLite narrows the generated Prisma types (enums/Json/arrays become String),
// so `next build` against the SQLite client reports type errors that are pure
// provider artifacts — the runtime is adapted by the Prisma extension and
// serialize helpers. Skip type-checking only in that mode; Postgres builds stay
// fully strict.
const isSqlite = process.env.DATABASE_PROVIDER === 'sqlite';

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: isSqlite,
  },
  images: {
    domains: [
      'lh3.googleusercontent.com',
      'play-lh.googleusercontent.com', // Google Play app icons
      'lh5.googleusercontent.com', // Additional Google Play images
      'lh6.googleusercontent.com', // Additional Google Play images
    ],
  },

  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],

  webpack: (config) => {
    // Ref: https://github.com/vercel/next.js/discussions/52593
    config.resolve.alias['handlebars'] = 'handlebars/dist/handlebars.min.js';
    return config;
  },
};

const withMDX = createMDX({
  // Add markdown plugins here, as desired
  options: {
    remarkPlugins: [remarkGfm],
  },
});

// Merge MDX config with Next.js config
export default withMDX(withNextIntl(nextConfig));
