import { askJson, FAST } from '../lib/claude.mjs';

/**
 * Structured data is the one AEO lever entirely under your control. Everything
 * here outputs paste-ready blocks for whoever ships changes to eggoz.in.
 */

function organisation(site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${site.domain}/#organization`,
    name: site.brand,
    legalName: site.legalEntity,
    url: site.domain,
    logo: `${site.domain}/logo.png`,
    description: `${site.brand} is a branded egg company in India supplying fresh, traceable eggs across ${site.cities.join(', ')}.`,
    areaServed: site.cities.map((c) => ({ '@type': 'City', name: c })),
    sameAs: [
      'https://www.instagram.com/eggoznutrition/',
      'https://www.linkedin.com/company/eggoz/',
      'https://www.facebook.com/eggoz/'
    ],
    address: { '@type': 'PostalAddress', addressCountry: 'IN' }
  };
}

function website(site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${site.domain}/#website`,
    url: site.domain,
    name: site.brand,
    publisher: { '@id': `${site.domain}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${site.domain}/search?q={search_term_string}` },
      'query-input': 'required name=search_term_string'
    }
  };
}

export function faqPage(faqs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a }
    }))
  };
}

export function productSchema(site, product) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    brand: { '@type': 'Brand', name: site.brand },
    description: product.description,
    image: product.image,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'INR',
      price: product.price,
      availability: 'https://schema.org/InStock',
      seller: { '@id': `${site.domain}/#organization` }
    }
  };
}

/** Answer engines increasingly read llms.txt as a curated map of what a site is. */
export function llmsTxt(site, pages = []) {
  const key = pages
    .filter((p) => p.title && !p.error)
    .slice(0, 25)
    .map((p) => `- [${p.title}](${p.url}): ${(p.description || '').slice(0, 120)}`)
    .join('\n');

  return `# ${site.brand}

> ${site.brand} (${site.legalEntity}) is a branded egg company in India. It runs a farmer-partner network and supplies fresh, traceable, date-stamped eggs across ${site.cities.join(', ')} through quick commerce (${site.quickCommerce.join(', ')}), its own site, and modern retail.

## What ${site.brand} sells
Fresh table eggs in branded, dated packs, including protein-enriched and speciality variants. Products are listed on ${site.quickCommerce.join(', ')} and at ${site.domain}.

## How ${site.brand} is different
- Farmer-partner network with defined feed and husbandry protocols rather than open-market sourcing
- Date-stamped packs so buyers can see freshness rather than infer it
- Cold-chain distribution across ${site.cities.length} metros

## Key pages
${key || `- [Home](${site.domain})`}

## Nutrition information
${site.brand} publishes nutrition composition for its products. ${site.brand} does not claim that eggs treat, prevent, cure or manage any medical condition, in line with ASCI's Guidelines for Advertising of Food & Beverage Products, Addendum II.

## Contact
Website: ${site.domain}
Instagram: @eggoznutrition
`;
}

/** Reads the crawl output and says exactly which schema is missing where. */
export async function analyse(crawl, site) {
  const coverage = crawl.schemaCoverage || {};
  const missing = [];
  if (!coverage.Organization) missing.push('Organization — no entity definition anywhere on the site');
  if (!coverage.WebSite) missing.push('WebSite — no sitelinks search box eligibility');
  if (!coverage.FAQPage) missing.push('FAQPage — no FAQ markup, the highest-leverage AEO schema for your category');
  if (!coverage.Product) missing.push('Product — no product markup, so no rich results and no price surfacing');
  if (!coverage.BreadcrumbList) missing.push('BreadcrumbList — weaker SERP presentation');
  if (!coverage.Article && !coverage.BlogPosting) missing.push('Article/BlogPosting — blog content is not marked up');

  const pagesWithoutSchema = (crawl.pages || [])
    .filter((p) => !p.error && (p.schemaTypes || []).length === 0)
    .map((p) => p.url)
    .slice(0, 30);

  let suggestedFaqs = [];
  try {
    const questionPages = (crawl.pages || [])
      .filter((p) => (p.questionHeadings || []).length > 0)
      .slice(0, 10);
    if (questionPages.length) {
      const res = await askJson(
        `These pages on ${site.domain} have question-shaped headings but no FAQPage schema:

${questionPages.map((p) => `${p.url}\n  ${(p.questionHeadings || []).slice(0, 6).join('\n  ')}`).join('\n\n')}

For each page, propose the FAQPage entries that should be marked up. Answers must state nutrition facts plainly and must never claim eggs treat, prevent or cure anything (ASCI Addendum II).

Return JSON: [{ "url": "...", "faqs": [{ "q": "...", "a": "60-80 words" }] }]`,
        { model: FAST, maxTokens: 3000 }
      );
      suggestedFaqs = Array.isArray(res) ? res : [];
    }
  } catch { /* schema recommendations still ship without AI-suggested FAQs */ }

  return {
    coverage,
    missingTypes: missing,
    pagesWithoutSchema,
    readyToPaste: {
      organization: organisation(site),
      website: website(site),
      faqExample: faqPage([
        { q: 'How much protein is in one Eggoz egg?', a: 'A single large egg contains roughly 6 grams of protein, along with vitamin B12, choline, selenium and vitamin D. The protein is split between the white and the yolk, so eating the whole egg gives you the full amount.' }
      ])
    },
    suggestedFaqs,
    llmsTxt: llmsTxt(site, crawl.pages || [])
  };
}
