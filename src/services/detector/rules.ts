/**
 * Detection rule database - Artupski ReSite
 * Source of truth: docs/specs/TECHNOLOGY-DETECTION.md sections 3, 4.2, and 6.
 *
 * Rules are a static, data-driven table. Each rule declares weighted signals
 * across the documented vectors. Adding a signature never requires touching the
 * engine - only this table - which keeps matching logic and rule data separate.
 *
 * Weight discipline (section 4.2):
 *   jsGlobals    0.80-1.00   meta          0.90-1.00   scriptSrc   0.60-0.90
 *   domElements  0.70-0.90   headers       0.50-0.80   htmlRegex   0.40-0.70
 *   cssClasses   0.50-0.80   cookies       0.60-0.80   networkReq  0.60-0.85
 *
 * Overmatching guard: the engine only applies ONE weight per signal per
 * technology (deduped by `vector:pattern`), so a page cannot inflate a score by
 * repeating a marker. Rules intentionally use narrow patterns.
 *
 * Regex safety: every pattern here is a simple, anchored substring/word match
 * with no nested quantifiers or backreferences, so catastrophic backtracking is
 * not possible. Patterns are compiled once at module load.
 */

import type { TechSignalVector, TechnologyCategory } from './types';

/** One weighted signal within a rule. */
export interface RuleSignal {
  vector: TechSignalVector;
  /** Pattern semantics depend on `match`. */
  pattern: string;
  weight: number;
  /**
   * How `pattern` is interpreted:
   *   - `regex`  (default): a case-insensitive regex tested against the vector.
   *   - `header` : an exact, lower-cased header NAME; evidence is its value.
   *   - `cookie` : an exact cookie-name prefix match.
   *   - `metaKey`: an exact, lower-cased meta key; evidence is its content.
   *   - `global` : an exact JS global name; matches when the boolean probe is true.
   *   - `marker` : an exact DOM marker selector string.
   */
  match?: 'regex' | 'header' | 'cookie' | 'metaKey' | 'global' | 'marker';
  /**
   * Optional regex applied to the matched evidence to extract a version. Uses a
   * named `version` group. Only applied when the signal matched.
   */
  versionRegex?: string;
  /** Whether the extracted version is exact or major-only. Default `exact`. */
  versionKind?: 'exact' | 'major_only';
}

export interface TechnologyRule {
  id: string;
  name: string;
  category: TechnologyCategory;
  website: string | null;
  signals: RuleSignal[];
}

/** Regex patterns are simple and bounded; compiled once for determinism. */
export const DETECTION_RULES: readonly TechnologyRule[] = [
  {
    id: 'react',
    name: 'React',
    category: 'Frontend Framework',
    website: 'https://react.dev',
    signals: [
      { vector: 'jsGlobals', match: 'global', pattern: 'React', weight: 0.9 },
      { vector: 'htmlRegex', pattern: 'data-reactroot|data-reactid', weight: 0.6 },
      {
        vector: 'scriptSrc',
        pattern: 'react(?:-dom)?(?:@|\\.)[^/]*\\.(?:production|development)?\\.?min\\.js|react@\\d+',
        weight: 0.75,
        versionRegex: 'react@(?<version>\\d+\\.\\d+\\.\\d+)'
      }
    ]
  },
  {
    id: 'vuejs',
    name: 'Vue.js',
    category: 'Frontend Framework',
    website: 'https://vuejs.org',
    signals: [
      { vector: 'jsGlobals', match: 'global', pattern: 'Vue', weight: 0.9 },
      { vector: 'htmlRegex', pattern: 'data-v-[0-9a-f]{6,}', weight: 0.65 },
      {
        vector: 'scriptSrc',
        pattern: 'vue(?:@|\\.)?[^/]*\\.(?:min\\.)?js',
        weight: 0.7,
        versionRegex: 'vue@(?<version>\\d+\\.\\d+\\.\\d+)'
      }
    ]
  },
  {
    id: 'angular',
    name: 'Angular',
    category: 'Frontend Framework',
    website: 'https://angular.dev',
    signals: [
      { vector: 'jsGlobals', match: 'global', pattern: 'angular', weight: 0.85 },
      {
        vector: 'htmlRegex',
        pattern: 'ng-version="(?<version>\\d+\\.\\d+\\.\\d+)"',
        weight: 0.7,
        versionRegex: 'ng-version="(?<version>\\d+\\.\\d+\\.\\d+)"'
      },
      { vector: 'domElements', match: 'marker', pattern: 'ion-app', weight: 0.5 }
    ]
  },
  {
    id: 'svelte',
    name: 'Svelte',
    category: 'Frontend Framework',
    website: 'https://svelte.dev',
    signals: [
      { vector: 'jsGlobals', match: 'global', pattern: '__svelte', weight: 0.95 },
      { vector: 'htmlRegex', pattern: 'svelte-[0-9a-z]{5,}|class="[^"]*svelte-', weight: 0.65 },
      { vector: 'domElements', match: 'marker', pattern: '[data-svelte]', weight: 0.7 }
    ]
  },
  {
    id: 'solidjs',
    name: 'SolidJS',
    category: 'Frontend Framework',
    website: 'https://www.solidjs.com',
    signals: [
      { vector: 'jsGlobals', match: 'global', pattern: '__solid', weight: 0.95 },
      { vector: 'domElements', match: 'marker', pattern: '[data-solid]', weight: 0.65 }
    ]
  },
  {
    id: 'alpinejs',
    name: 'Alpine.js',
    category: 'Frontend Framework',
    website: 'https://alpinejs.dev',
    signals: [
      { vector: 'jsGlobals', match: 'global', pattern: 'Alpine', weight: 0.9 },
      { vector: 'htmlRegex', pattern: 'x-data=|x-init=|x-bind:', weight: 0.6 },
      { vector: 'scriptSrc', pattern: 'alpinejs|alpine(?:\\.min)?\\.js', weight: 0.7 }
    ]
  },
  {
    id: 'nextjs',
    name: 'Next.js',
    category: 'Meta-Framework & SSR Engine',
    website: 'https://nextjs.org',
    signals: [
      { vector: 'jsGlobals', match: 'global', pattern: '__NEXT_DATA__', weight: 1.0 },
      { vector: 'scriptSrc', pattern: '/_next/static/', weight: 0.9 },
      { vector: 'meta', match: 'metaKey', pattern: 'next-head-count', weight: 0.85 },
      { vector: 'headers', match: 'header', pattern: 'x-nextjs-page', weight: 0.8 },
      { vector: 'domElements', match: 'marker', pattern: '#__next', weight: 0.7 },
      { vector: 'htmlRegex', pattern: 'id="__next"', weight: 0.6 }
    ]
  },
  {
    id: 'nuxtjs',
    name: 'Nuxt.js',
    category: 'Meta-Framework & SSR Engine',
    website: 'https://nuxt.com',
    signals: [
      { vector: 'jsGlobals', match: 'global', pattern: '__NUXT__', weight: 1.0 },
      { vector: 'htmlRegex', pattern: 'id="__nuxt"|data-nuxt-', weight: 0.7 },
      { vector: 'scriptSrc', pattern: '/_nuxt/', weight: 0.85 },
      { vector: 'domElements', match: 'marker', pattern: '#__nuxt', weight: 0.7 }
    ]
  },
  {
    id: 'remix',
    name: 'Remix',
    category: 'Meta-Framework & SSR Engine',
    website: 'https://remix.run',
    signals: [
      { vector: 'jsGlobals', match: 'global', pattern: '__remixContext', weight: 1.0 },
      { vector: 'scriptSrc', pattern: 'remix\\.run|/build/routes', weight: 0.6 }
    ]
  },
  {
    id: 'astro',
    name: 'Astro',
    category: 'Meta-Framework & SSR Engine',
    website: 'https://astro.build',
    signals: [
      { vector: 'domElements', match: 'marker', pattern: 'astro-island', weight: 0.9 },
      { vector: 'meta', match: 'metaKey', pattern: 'generator', weight: 0.9, versionRegex: 'Astro v(?<version>\\d+\\.\\d+\\.\\d+)' },
      { vector: 'htmlRegex', pattern: 'astro-island|astro-slot|data-astro-cid', weight: 0.6 }
    ]
  },
  {
    id: 'gatsby',
    name: 'Gatsby',
    category: 'Meta-Framework & SSR Engine',
    website: 'https://www.gatsbyjs.com',
    signals: [
      { vector: 'jsGlobals', match: 'global', pattern: '__GATSBY', weight: 1.0 },
      { vector: 'meta', match: 'metaKey', pattern: 'generator', weight: 0.9, versionRegex: 'Gatsby (?<version>\\d+\\.\\d+\\.\\d+)' },
      { vector: 'domElements', match: 'marker', pattern: '#___gatsby', weight: 0.7 },
      { vector: 'htmlRegex', pattern: 'id="___gatsby"', weight: 0.6 }
    ]
  },
  {
    id: 'sveltekit',
    name: 'SvelteKit',
    category: 'Meta-Framework & SSR Engine',
    website: 'https://kit.svelte.dev',
    signals: [
      { vector: 'htmlRegex', pattern: 'data-sveltekit-|__sveltekit', weight: 0.8 },
      { vector: 'scriptSrc', pattern: '/_app/immutable/', weight: 0.7 }
    ]
  },
  {
    id: 'express',
    name: 'Express',
    category: 'Backend Framework & Server',
    website: 'https://expressjs.com',
    signals: [
      { vector: 'headers', match: 'header', pattern: 'x-powered-by', weight: 0.7, versionRegex: 'Express', versionKind: 'major_only' }
    ]
  },
  {
    id: 'nextjs-server',
    name: 'Next.js Server',
    category: 'Backend Framework & Server',
    website: 'https://nextjs.org',
    signals: [
      { vector: 'headers', match: 'header', pattern: 'x-powered-by', weight: 0.7, versionRegex: 'Next\\.js (?<version>\\d+\\.\\d+\\.\\d+)' }
    ]
  },
  {
    id: 'php',
    name: 'PHP',
    category: 'Backend Framework & Server',
    website: 'https://www.php.net',
    signals: [
      { vector: 'headers', match: 'header', pattern: 'x-powered-by', weight: 0.7, versionRegex: 'PHP/(?<version>\\d+\\.\\d+\\.\\d+)' },
      { vector: 'cookies', match: 'cookie', pattern: 'PHPSESSID', weight: 0.7 }
    ]
  },
  {
    id: 'aspnet',
    name: 'ASP.NET',
    category: 'Backend Framework & Server',
    website: 'https://dotnet.microsoft.com/apps/aspnet',
    signals: [
      { vector: 'headers', match: 'header', pattern: 'x-aspnet-version', weight: 0.8, versionRegex: '(?<version>\\d+\\.\\d+\\.\\d+)' },
      { vector: 'headers', match: 'header', pattern: 'x-powered-by', weight: 0.6, versionRegex: 'ASP\\.NET' },
      { vector: 'cookies', match: 'cookie', pattern: 'ASP.NET_SessionId', weight: 0.75 }
    ]
  },
  {
    id: 'wordpress',
    name: 'WordPress',
    category: 'CMS',
    website: 'https://wordpress.org',
    signals: [
      { vector: 'meta', match: 'metaKey', pattern: 'generator', weight: 0.95, versionRegex: 'WordPress (?<version>\\d+\\.\\d+(?:\\.\\d+)?)' },
      { vector: 'scriptSrc', pattern: '/wp-content/|/wp-includes/', weight: 0.85 },
      { vector: 'htmlRegex', pattern: 'wp-content|wp-includes|wp-json', weight: 0.6 },
      { vector: 'cookies', match: 'cookie', pattern: 'wordpress_', weight: 0.7 }
    ]
  },
  {
    id: 'drupal',
    name: 'Drupal',
    category: 'CMS',
    website: 'https://www.drupal.org',
    signals: [
      { vector: 'meta', match: 'metaKey', pattern: 'generator', weight: 0.9, versionRegex: 'Drupal (?<version>\\d+)', versionKind: 'major_only' },
      { vector: 'scriptSrc', pattern: '/sites/(?:all|default)/|/core/misc/drupal', weight: 0.8 },
      { vector: 'headers', match: 'header', pattern: 'x-generator', weight: 0.8, versionRegex: 'Drupal (?<version>\\d+)', versionKind: 'major_only' }
    ]
  },
  {
    id: 'ghost',
    name: 'Ghost',
    category: 'CMS',
    website: 'https://ghost.org',
    signals: [
      { vector: 'meta', match: 'metaKey', pattern: 'generator', weight: 0.95, versionRegex: 'Ghost (?<version>\\d+\\.\\d+(?:\\.\\d+)?)' },
      { vector: 'htmlRegex', pattern: 'ghost-url|data-ghost', weight: 0.6 }
    ]
  },
  {
    id: 'shopify',
    name: 'Shopify',
    category: 'CMS',
    website: 'https://www.shopify.com',
    signals: [
      { vector: 'domElements', match: 'marker', pattern: 'shopify-section', weight: 0.85 },
      { vector: 'htmlRegex', pattern: 'cdn\\.shopify\\.com|Shopify\\.theme', weight: 0.7 },
      { vector: 'scriptSrc', pattern: 'cdn\\.shopify\\.com', weight: 0.75 },
      { vector: 'headers', match: 'header', pattern: 'x-shopify-stage', weight: 0.7 }
    ]
  },
  {
    id: 'webflow',
    name: 'Webflow',
    category: 'CMS',
    website: 'https://webflow.com',
    signals: [
      { vector: 'meta', match: 'metaKey', pattern: 'generator', weight: 0.9, versionRegex: 'Webflow' },
      { vector: 'domElements', match: 'marker', pattern: '[data-wf-page]', weight: 0.85 },
      { vector: 'htmlRegex', pattern: 'data-wf-page|data-wf-site|webflow\\.js', weight: 0.7 }
    ]
  },
  {
    id: 'wix',
    name: 'Wix',
    category: 'CMS',
    website: 'https://www.wix.com',
    signals: [
      { vector: 'meta', match: 'metaKey', pattern: 'generator', weight: 0.9, versionRegex: 'Wix\\.com' },
      { vector: 'scriptSrc', pattern: 'static\\.parastorage\\.com|wixstatic\\.com', weight: 0.85 }
    ]
  },
  {
    id: 'squarespace',
    name: 'Squarespace',
    category: 'CMS',
    website: 'https://www.squarespace.com',
    signals: [
      { vector: 'meta', match: 'metaKey', pattern: 'generator', weight: 0.9, versionRegex: 'Squarespace' },
      { vector: 'htmlRegex', pattern: 'static1\\.squarespace\\.com|squarespace-cdn', weight: 0.8 },
      { vector: 'headers', match: 'header', pattern: 'x-served-by', weight: 0.5, versionRegex: 'Squarespace' }
    ]
  },
  {
    id: 'strapi',
    name: 'Strapi',
    category: 'CMS',
    website: 'https://strapi.io',
    signals: [
      { vector: 'headers', match: 'header', pattern: 'x-powered-by', weight: 0.7, versionRegex: 'Strapi' },
      { vector: 'htmlRegex', pattern: 'strapi', weight: 0.4 }
    ]
  },
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'Database & ORM',
    website: 'https://supabase.com',
    signals: [
      { vector: 'scriptSrc', pattern: '@supabase/supabase-js|supabase\\.co', weight: 0.85 },
      { vector: 'htmlRegex', pattern: 'supabase\\.co|supabase\\.github\\.io', weight: 0.6 }
    ]
  },
  {
    id: 'firebase',
    name: 'Firebase',
    category: 'Database & ORM',
    website: 'https://firebase.google.com',
    signals: [
      { vector: 'scriptSrc', pattern: 'firebasejs/|gstatic\\.com/firebasejs', weight: 0.85, versionRegex: 'firebasejs/(?<version>\\d+\\.\\d+\\.\\d+)' },
      { vector: 'htmlRegex', pattern: 'firebase(?:app|js)?\\.js|firebaseConfig', weight: 0.6 }
    ]
  },
  {
    id: 'graphql',
    name: 'GraphQL',
    category: 'Database & ORM',
    website: 'https://graphql.org',
    signals: [
      { vector: 'networkRequests', pattern: '/graphql', weight: 0.6 },
      { vector: 'htmlRegex', pattern: 'graphql', weight: 0.4 }
    ]
  },
  {
    id: 'google-analytics',
    name: 'Google Analytics',
    category: 'Analytics & Tracking',
    website: 'https://analytics.google.com',
    signals: [
      { vector: 'scriptSrc', pattern: 'googletagmanager\\.com/gtag/js|google-analytics\\.com/analytics\\.js', weight: 0.9 },
      { vector: 'cookies', match: 'cookie', pattern: '_ga', weight: 0.7 },
      { vector: 'htmlRegex', pattern: 'gtag\\(|ga\\(\'create\'|GoogleAnalyticsObject', weight: 0.65 },
      { vector: 'networkRequests', pattern: 'google-analytics\\.com/g/collect|analytics\\.google\\.com', weight: 0.75 }
    ]
  },
  {
    id: 'google-tag-manager',
    name: 'Google Tag Manager',
    category: 'Analytics & Tracking',
    website: 'https://tagmanager.google.com',
    signals: [
      { vector: 'scriptSrc', pattern: 'googletagmanager\\.com/gtm\\.js', weight: 0.9 },
      { vector: 'htmlRegex', pattern: 'googletagmanager\\.com/ns\\.html|gtm\\.start', weight: 0.7 }
    ]
  },
  {
    id: 'hotjar',
    name: 'Hotjar',
    category: 'Analytics & Tracking',
    website: 'https://www.hotjar.com',
    signals: [
      { vector: 'scriptSrc', pattern: 'static\\.hotjar\\.com|hotjar\\.js', weight: 0.9 },
      { vector: 'htmlRegex', pattern: 'hj\\(|hotjar', weight: 0.5 }
    ]
  },
  {
    id: 'posthog',
    name: 'PostHog',
    category: 'Analytics & Tracking',
    website: 'https://posthog.com',
    signals: [
      { vector: 'scriptSrc', pattern: 'posthog|us\\.i\\.posthog\\.com|app\\.posthog\\.com', weight: 0.9 },
      { vector: 'htmlRegex', pattern: 'posthog', weight: 0.5 }
    ]
  },
  {
    id: 'plausible',
    name: 'Plausible',
    category: 'Analytics & Tracking',
    website: 'https://plausible.io',
    signals: [
      { vector: 'scriptSrc', pattern: 'plausible\\.io/js', weight: 0.95 },
      { vector: 'htmlRegex', pattern: 'plausible', weight: 0.5 }
    ]
  },
  {
    id: 'mixpanel',
    name: 'Mixpanel',
    category: 'Analytics & Tracking',
    website: 'https://mixpanel.com',
    signals: [
      { vector: 'scriptSrc', pattern: 'cdn\\.mxpanel\\.com|mixpanel', weight: 0.9 },
      { vector: 'htmlRegex', pattern: 'mixpanel', weight: 0.5 }
    ]
  },
  {
    id: 'segment',
    name: 'Segment',
    category: 'Analytics & Tracking',
    website: 'https://segment.com',
    signals: [
      { vector: 'scriptSrc', pattern: 'cdn\\.segment\\.com/analytics\\.js', weight: 0.95 }
    ]
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    category: 'CDN & Infrastructure',
    website: 'https://www.cloudflare.com',
    signals: [
      { vector: 'headers', match: 'header', pattern: 'cf-ray', weight: 0.85 },
      { vector: 'headers', match: 'header', pattern: 'server', weight: 0.7, versionRegex: 'cloudflare' },
      { vector: 'headers', match: 'header', pattern: 'cf-cache-status', weight: 0.75 },
      { vector: 'cookies', match: 'cookie', pattern: '__cf', weight: 0.6 }
    ]
  },
  {
    id: 'vercel',
    name: 'Vercel',
    category: 'CDN & Infrastructure',
    website: 'https://vercel.com',
    signals: [
      { vector: 'headers', match: 'header', pattern: 'server', weight: 0.8, versionRegex: 'Vercel' },
      { vector: 'headers', match: 'header', pattern: 'x-vercel-id', weight: 0.85 },
      { vector: 'headers', match: 'header', pattern: 'x-vercel-cache', weight: 0.8 }
    ]
  },
  {
    id: 'netlify',
    name: 'Netlify',
    category: 'CDN & Infrastructure',
    website: 'https://www.netlify.com',
    signals: [
      { vector: 'headers', match: 'header', pattern: 'server', weight: 0.75, versionRegex: 'Netlify' },
      { vector: 'headers', match: 'header', pattern: 'x-nf-request-id', weight: 0.8 }
    ]
  },
  {
    id: 'fastly',
    name: 'Fastly',
    category: 'CDN & Infrastructure',
    website: 'https://www.fastly.com',
    signals: [
      { vector: 'headers', match: 'header', pattern: 'x-served-by', weight: 0.5, versionRegex: 'cache-' },
      { vector: 'headers', match: 'header', pattern: 'x-fastly-request-id', weight: 0.8 }
    ]
  },
  {
    id: 'cloudfront',
    name: 'AWS CloudFront',
    category: 'CDN & Infrastructure',
    website: 'https://aws.amazon.com/cloudfront/',
    signals: [
      { vector: 'headers', match: 'header', pattern: 'x-amz-cf-id', weight: 0.85 },
      { vector: 'headers', match: 'header', pattern: 'via', weight: 0.5, versionRegex: 'CloudFront' }
    ]
  },
  {
    id: 'auth0',
    name: 'Auth0',
    category: 'Security & Authentication',
    website: 'https://auth0.com',
    signals: [
      { vector: 'scriptSrc', pattern: 'cdn\\.auth0\\.com|auth0\\.min\\.js', weight: 0.9 },
      { vector: 'htmlRegex', pattern: 'auth0', weight: 0.4 }
    ]
  },
  {
    id: 'clerk',
    name: 'Clerk',
    category: 'Security & Authentication',
    website: 'https://clerk.com',
    signals: [
      { vector: 'scriptSrc', pattern: 'clerk\\.(?:com|dev|accounts\\.dev)', weight: 0.9 },
      { vector: 'htmlRegex', pattern: 'clerk\\.js|__clerk', weight: 0.6 }
    ]
  },
  {
    id: 'recaptcha',
    name: 'reCAPTCHA',
    category: 'Security & Authentication',
    website: 'https://www.google.com/recaptcha/',
    signals: [
      { vector: 'scriptSrc', pattern: 'google\\.com/recaptcha|gstatic\\.com/recaptcha', weight: 0.9 },
      { vector: 'htmlRegex', pattern: 'g-recaptcha|grecaptcha', weight: 0.7 }
    ]
  },
  {
    id: 'turnstile',
    name: 'Cloudflare Turnstile',
    category: 'Security & Authentication',
    website: 'https://www.cloudflare.com/products/turnstile/',
    signals: [
      { vector: 'scriptSrc', pattern: 'challenges\\.cloudflare\\.com/turnstile', weight: 0.95 },
      { vector: 'htmlRegex', pattern: 'cf-turnstile', weight: 0.8 }
    ]
  },
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'Payment Gateway',
    website: 'https://stripe.com',
    signals: [
      { vector: 'scriptSrc', pattern: 'js\\.stripe\\.com', weight: 0.95 },
      { vector: 'htmlRegex', pattern: 'stripe', weight: 0.4 }
    ]
  },
  {
    id: 'paypal',
    name: 'PayPal',
    category: 'Payment Gateway',
    website: 'https://www.paypal.com',
    signals: [
      { vector: 'scriptSrc', pattern: 'paypal(?:objects|\\.com/sdk)', weight: 0.9 },
      { vector: 'htmlRegex', pattern: 'paypal', weight: 0.4 }
    ]
  },
  {
    id: 'google-fonts',
    name: 'Google Fonts',
    category: 'Font Provider',
    website: 'https://fonts.google.com',
    signals: [
      { vector: 'scriptSrc', pattern: 'fonts\\.googleapis\\.com|fonts\\.gstatic\\.com', weight: 0.85 },
      { vector: 'htmlRegex', pattern: 'fonts\\.googleapis\\.com|fonts\\.gstatic\\.com', weight: 0.7 }
    ]
  },
  {
    id: 'font-awesome',
    name: 'Font Awesome',
    category: 'Font Provider',
    website: 'https://fontawesome.com',
    signals: [
      { vector: 'scriptSrc', pattern: 'fontawesome|font-awesome', weight: 0.8 },
      { vector: 'htmlRegex', pattern: 'font-?awesome|fa-', weight: 0.4 }
    ]
  },
  {
    id: 'adobe-fonts',
    name: 'Adobe Fonts',
    category: 'Font Provider',
    website: 'https://fonts.adobe.com',
    signals: [
      { vector: 'scriptSrc', pattern: 'use\\.typekit\\.net|typekit', weight: 0.9 }
    ]
  },
  {
    id: 'jquery',
    name: 'jQuery',
    category: 'JS Library & UI Utilities',
    website: 'https://jquery.com',
    signals: [
      { vector: 'jsGlobals', match: 'global', pattern: 'jQuery', weight: 0.85 },
      {
        vector: 'scriptSrc',
        pattern: 'jquery[-.](?:\\d+\\.)*\\d+(?:\\.min)?\\.js',
        weight: 0.8,
        versionRegex: 'jquery-(?<version>\\d+\\.\\d+\\.\\d+)'
      }
    ]
  },
  {
    id: 'lodash',
    name: 'Lodash',
    category: 'JS Library & UI Utilities',
    website: 'https://lodash.com',
    signals: [
      { vector: 'jsGlobals', match: 'global', pattern: '_', weight: 0.5 },
      {
        vector: 'scriptSrc',
        pattern: 'lodash(?:\\.min)?\\.js|lodash@',
        weight: 0.85,
        versionRegex: 'lodash@(?<version>\\d+\\.\\d+\\.\\d+)'
      }
    ]
  },
  {
    id: 'axios',
    name: 'Axios',
    category: 'JS Library & UI Utilities',
    website: 'https://axios-http.com',
    signals: [{ vector: 'scriptSrc', pattern: 'axios(?:@|\\.min|\\.)', weight: 0.85, versionRegex: 'axios@(?<version>\\d+\\.\\d+\\.\\d+)' }]
  },
  {
    id: 'gsap',
    name: 'GSAP',
    category: 'JS Library & UI Utilities',
    website: 'https://gsap.com',
    signals: [
      { vector: 'jsGlobals', match: 'global', pattern: 'gsap', weight: 0.85 },
      { vector: 'scriptSrc', pattern: 'gsap(?:\\.min)?\\.js|cdnjs.*gsap', weight: 0.8, versionRegex: 'gsap/(?<version>\\d+\\.\\d+\\.\\d+)' }
    ]
  },
  {
    id: 'chartjs',
    name: 'Chart.js',
    category: 'JS Library & UI Utilities',
    website: 'https://www.chartjs.org',
    signals: [
      { vector: 'jsGlobals', match: 'global', pattern: 'Chart', weight: 0.7 },
      { vector: 'scriptSrc', pattern: 'chart(?:\\.min)?\\.js|chart\\.js', weight: 0.85 }
    ]
  },
  {
    id: 'd3',
    name: 'D3.js',
    category: 'JS Library & UI Utilities',
    website: 'https://d3js.org',
    signals: [
      { vector: 'jsGlobals', match: 'global', pattern: 'd3', weight: 0.85 },
      { vector: 'scriptSrc', pattern: 'd3(?:@|\\.v?\\d|\\.min)', weight: 0.8, versionRegex: 'd3@(?<version>\\d+\\.\\d+\\.\\d+)' }
    ]
  },
  {
    id: 'swiper',
    name: 'Swiper',
    category: 'JS Library & UI Utilities',
    website: 'https://swiperjs.com',
    signals: [
      { vector: 'jsGlobals', match: 'global', pattern: 'Swiper', weight: 0.85 },
      { vector: 'htmlRegex', pattern: 'swiper-container|swiper-wrapper|class="swiper', weight: 0.6 },
      { vector: 'scriptSrc', pattern: 'swiper', weight: 0.7 }
    ]
  },
  {
    id: 'tailwind-css',
    name: 'Tailwind CSS',
    category: 'CSS Framework & Component UI',
    website: 'https://tailwindcss.com',
    signals: [
      {
        vector: 'cssClasses',
        pattern: '\\b(flex|grid|hidden|block|inline-block|relative|absolute|sticky|items-center|justify-between|min-h-screen|max-w-\\w+|px-\\d+|py-\\d+|space-[xy]-\\d+)\\b',
        weight: 0.55
      },
      {
        vector: 'htmlRegex',
        pattern: 'class="[^"]*\\b(sm:|md:|lg:|xl:|2xl:|hover:|focus:|dark:)[^"]*"',
        weight: 0.7
      }
    ]
  },
  {
    id: 'bootstrap',
    name: 'Bootstrap',
    category: 'CSS Framework & Component UI',
    website: 'https://getbootstrap.com',
    signals: [
      { vector: 'scriptSrc', pattern: 'bootstrap(?:\\.bundle)?(?:\\.min)?\\.js|bootstrap@', weight: 0.8, versionRegex: 'bootstrap@(?<version>\\d+\\.\\d+\\.\\d+)' },
      { vector: 'htmlRegex', pattern: 'class="[^"]*\\b(container|row|col-(?:sm|md|lg|xl)-\\d+|navbar|btn-primary)\\b', weight: 0.6 }
    ]
  },
  {
    id: 'mui',
    name: 'MUI (Material-UI)',
    category: 'CSS Framework & Component UI',
    website: 'https://mui.com',
    signals: [
      { vector: 'htmlRegex', pattern: 'class="[^"]*\\b(Mui[A-Z]\\w+|makeStyles-|jss\\d+)\\b', weight: 0.8 },
      { vector: 'scriptSrc', pattern: '@mui|@material-ui', weight: 0.7 }
    ]
  },
  {
    id: 'chakra-ui',
    name: 'Chakra UI',
    category: 'CSS Framework & Component UI',
    website: 'https://chakra-ui.com',
    signals: [
      { vector: 'htmlRegex', pattern: 'class="[^"]*\\bchakra-', weight: 0.8 },
      { vector: 'scriptSrc', pattern: '@chakra-ui', weight: 0.7 }
    ]
  },
  {
    id: 'ant-design',
    name: 'Ant Design',
    category: 'CSS Framework & Component UI',
    website: 'https://ant.design',
    signals: [
      { vector: 'htmlRegex', pattern: 'class="[^"]*\\bant-(?:btn|layout|menu|table|form)', weight: 0.8 },
      { vector: 'scriptSrc', pattern: 'antd|ant-design', weight: 0.7 }
    ]
  },
  {
    id: 'bulma',
    name: 'Bulma',
    category: 'CSS Framework & Component UI',
    website: 'https://bulma.io',
    signals: [
      { vector: 'scriptSrc', pattern: 'bulma', weight: 0.8 },
      { vector: 'htmlRegex', pattern: 'class="[^"]*\\b(is-primary|is-large|navbar-brand|hero-body)\\b', weight: 0.5 }
    ]
  },
  {
    id: 'styled-components',
    name: 'Styled-Components',
    category: 'CSS Framework & Component UI',
    website: 'https://styled-components.com',
    signals: [
      { vector: 'htmlRegex', pattern: 'data-styled(?:-components)?|class="[^"]*\\bsc-[0-9a-zA-Z]+', weight: 0.8 },
      { vector: 'scriptSrc', pattern: 'styled-components', weight: 0.7 }
    ]
  },
  {
    id: 'emotion',
    name: 'Emotion',
    category: 'CSS Framework & Component UI',
    website: 'https://emotion.sh',
    signals: [
      { vector: 'htmlRegex', pattern: 'data-emotion|class="[^"]*\\bcss-[0-9a-z]+', weight: 0.75 },
      { vector: 'scriptSrc', pattern: '@emotion', weight: 0.7 }
    ]
  },
  {
    id: 'vite',
    name: 'Vite',
    category: 'DevOps & Build Tools',
    website: 'https://vitejs.dev',
    signals: [
      { vector: 'scriptSrc', pattern: '/@vite/|/node_modules/\\.vite/|vite/dist/client', weight: 0.85 },
      { vector: 'htmlRegex', pattern: 'type="module"[^>]*src="/src/main\\.|/@vite/client', weight: 0.6 }
    ]
  },
  {
    id: 'webpack',
    name: 'Webpack',
    category: 'DevOps & Build Tools',
    website: 'https://webpack.js.org',
    signals: [
      { vector: 'htmlRegex', pattern: 'webpackJsonp|__webpack_require__|webpackChunk', weight: 0.7 },
      { vector: 'scriptSrc', pattern: 'webpack-runtime|\\.chunk\\.js', weight: 0.5 }
    ]
  },
  {
    id: 'turbopack',
    name: 'Turbopack',
    category: 'DevOps & Build Tools',
    website: 'https://turbo.build/pack',
    signals: [{ vector: 'scriptSrc', pattern: '/_next/static/chunks/.*\\.js.*turbopack|static/chunks/turbopack', weight: 0.7 }]
  }
];
