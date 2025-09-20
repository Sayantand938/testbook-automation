// src/workflows/scrapper/utils/sanitizer.js

import * as cheerio from 'cheerio';
import { minify } from 'html-minifier-terser';

const minifierOptions = {
  collapseWhitespace: true,
  removeComments: true,
  removeOptionalTags: true,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  removeTagWhitespace: true,
  useShortDoctype: true,
  minifyCSS: true,
  minifyJS: true,
};

async function minifyHtml(htmlString) {
  if (typeof htmlString !== 'string' || !htmlString) return htmlString;
  try {
    return await minify(htmlString, minifierOptions);
  } catch (error)
  {
    console.warn('HTML minification failed, returning original snippet. Error:', error.message);
    return htmlString;
  }
}

export async function transformAndSanitizeHtml(htmlString) {
  if (typeof htmlString !== 'string' || !htmlString) return htmlString || '';

  // Load the HTML into Cheerio for manipulation.
  const $ = cheerio.load(htmlString, { decodeEntities: false }, false);

  // --- DOM MANIPULATIONS ---

  // Remove all inline styles, as they can interfere with presentation.
  $('*').removeAttr('style');

  // Unwrap legacy or framework-specific tags, keeping their content.
  $('font').each((_, el) => $(el).replaceWith($(el).html()));
  $('span.math-tex').each((_, el) => $(el).replaceWith($(el).html()));

  // Remove junk tags often left by WYSIWYG editors or frameworks.
  $('o\\:p, span.ng-binding').remove();

  // NEW: Convert spans containing only numbers to <sup> tags (for exponents).
  // This fixes cases like `x<span>2</span>` which should be `x<sup>2</sup>`.
  $('span').each((_, el) => {
    const element = $(el);
    // Check if the span contains only digits and has no other nested elements.
    if (/^\d+$/.test(element.text().trim()) && element.children().length === 0) {
      element.replaceWith(`<sup>${element.html()}</sup>`);
    }
  });

  // Convert MathJax script tags into standard LaTeX format.
  $('script[type="math/tex"]').each((_, el) => {
    const latex = $(el).html();
    if (latex && latex.trim()) $(el).replaceWith(`\\(${latex.trim()}\\)`);
  });
  $('.MathJax, .MathJax_Preview, .MJX_Assistive_MathML').remove();

  // Remove specific decorative <img> tags that are not part of the content.
  $('img').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (
      src.includes('lms_creative_elements/key-point-image.png') ||
      src.includes('lms_creative_elements/additional-information-image.png')
    ) {
      $(el).remove();
    }
  });

  // Unwrap <p> tags into their content followed by a <br> to simplify structure.
  $('p').each((_, el) => {
    const innerHtml = $(el).html();
    if (innerHtml && innerHtml.trim() !== '') $(el).replaceWith(innerHtml + '<br>');
    else $(el).remove();
  });

  // Clean up table attributes and content for consistency.
  $('table').removeAttr('cellpadding').removeAttr('cellspacing');
  $('table').find('br').remove();

  // Remove <br> tags immediately before and after tables for cleaner spacing.
  $('table').each((_, table) => {
    let prev = $(table).prev();
    while (prev.is('br')) {
      const temp = prev.prev();
      prev.remove();
      prev = temp;
    }

    let next = $(table).next();
    while (next.is('br')) {
      const temp = next.next();
      next.remove();
      next = temp;
    }
  });

  let processedHtml = $.html();

  processedHtml = processedHtml.replace(/<!--[\s\S]*?-->/g, '');      // Remove HTML comments.
  processedHtml = processedHtml.replace(/&nbsp;/g, ' ');               // Replace non-breaking spaces with regular spaces.
  processedHtml = processedHtml.replace(/\u00AD/g, '');                 // NEW: Remove soft hyphens, which can be invisible and problematic.
  processedHtml = processedHtml.replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>'); // Collapse 3+ line breaks into just two.
  processedHtml = processedHtml.replace(/^(\s*<br\s*\/?>)+|(<br\s*\/?>\s*)+$/gi, ''); // Remove all leading and trailing line breaks.


  const minifiedHtml = await minifyHtml(processedHtml);

  return minifiedHtml.trim();
}