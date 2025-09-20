// src/workflows/scrapper/scraper.js

import CDP from 'chrome-remote-interface';
import { program } from 'commander';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { selectors } from './utils/selectors.js';
import { transformAndSanitizeHtml } from './utils/sanitizer.js';

// --------------------- Logging ---------------------
const consoleLog = {
  action: (msg) => console.log(`[*] ${msg}`),
  info: (msg) => console.log(`[i] ${msg}`),
  success: (msg) => console.log(`[✓] ${msg}`),
  warn: (msg) => console.log(`[?] ${msg}`),
  error: (msg) => console.error(`[x] ${msg}`),
};

function createLogger(logFilePath) {
  const logDir = path.dirname(logFilePath);
  fs.mkdirSync(logDir, { recursive: true });
  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  const formatFileMessage = (level, msg) => `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}\n`;

  return {
    action: (msg) => { console.log(`[*] ${msg}`); logStream.write(formatFileMessage('action', msg)); },
    info: (msg) => { console.log(`[i] ${msg}`); logStream.write(formatFileMessage('info', msg)); },
    success: (msg) => { console.log(`[✓] ${msg}`); logStream.write(formatFileMessage('success', msg)); },
    warn: (msg) => { console.log(`[?] ${msg}`); logStream.write(formatFileMessage('warn', msg)); },
    error: (msg) => { 
      const message = msg instanceof Error ? (msg.stack || msg.toString()) : msg;
      console.error(`[x] ${message}`); 
      logStream.write(formatFileMessage('error', message));
    },
    close: () => { logStream.end(); }
  };
}

// --------------------- Delays & Randomization ---------------------
const delay = ms => new Promise(res => setTimeout(res, ms));
const randomDelay = (min, max) => delay(Math.floor(Math.random() * (max - min + 1) + min));

// --------------------- Timeout Error ---------------------
class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "TimeoutError";
  }
}

// --------------------- Wait for Selector ---------------------
async function waitForSelector(Runtime, selector, timeout) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const { result } = await Runtime.evaluate({ expression: `document.querySelector('${selector}') !== null` });
    if (result.value) return;
    await delay(250);
  }
  throw new TimeoutError(`Timeout: waited ${timeout}ms for selector "${selector}"`);
}

// --------------------- Human-like Scroll & Mouse ---------------------
async function smoothScroll(Runtime, distance = 150, steps = 5) {
  const stepSize = distance / steps;
  for (let i = 0; i < steps; i++) {
    const direction = Math.random() > 0.5 ? 1 : -1;
    await Runtime.evaluate({ expression: `window.scrollBy(0, ${stepSize * direction})` });
    // FASTER: Reduced scroll delay
    await randomDelay(20, 50);
  }
}

async function humanMoveMouse(Input, startX, startY, endX, endY, steps = 8) {
  for (let i = 0; i <= steps; i++) {
    const x = startX + ((endX - startX) * i) / steps + Math.random() * 2;
    const y = startY + ((endY - startY) * i) / steps + Math.random() * 2;
    await Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
    // FASTER: Reduced mouse move delay
    await randomDelay(5, 15);
  }
}

async function humanClick(Runtime, Input, selector) {
  const { result } = await Runtime.evaluate({
    expression: `(() => {
      const el = document.querySelector('${selector}');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })();`,
    returnByValue: true
  });

  if (!result.value) throw new Error(`Selector not found: ${selector}`);
  const { x, y } = result.value;

  await humanMoveMouse(Input, x + Math.random()*20 - 10, y + Math.random()*20 - 10, x, y);
  // FASTER: Reduced pre-click delay
  await randomDelay(50, 150);

  await Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await randomDelay(40, 80);
  await Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  // FASTER: Reduced post-click delay
  await randomDelay(100, 200);
}

// --------------------- Tagging ---------------------
function getTagForQuestion(sectionName, questionNumber) {
  if (!sectionName || typeof questionNumber !== 'number') return null;
  const s = sectionName.trim();
  if (s === "Section I") {
    if (questionNumber >= 1 && questionNumber <= 30) return 'MATH';
    if (questionNumber >= 31 && questionNumber <= 60) return 'GI';
  }
  if (s === "Section II") {
    if (questionNumber >= 1 && questionNumber <= 45) return 'ENG';
    if (questionNumber >= 46 && questionNumber <= 70) return 'GK';
  }
  const lc = s.toLowerCase();
  if (lc.includes("quantitative") || lc.includes("quants")) return 'MATH';
  if (lc.includes("intelligence") || lc.includes("reasoning")) return 'GI';
  if (lc.includes("english")) return 'ENG';
  if (lc.includes("awareness") || lc.includes("knowledge")) return 'GK';
  if (lc.includes("computer")) return 'COMPUTER';
  if (lc.includes("bengali")) return 'BENGALI';
  return null;
}

// --------------------- Scrape Single Question ---------------------
async function scrapeSingleQuestionPage(html, fallbackCounter, log, noteId, serialNumber) {
  try {
    const $ = cheerio.load(html);
    const s = selectors.parser;
    const $container = $(s.activeQuestionContainer);
    if ($container.length === 0) { log.warn('No active question container.'); return null; }

    const $numEl = $container.find(s.questionNumber).clone();
    $numEl.find('span.hidden-xs').remove();
    const slText = $numEl.text().trim();
    const qNum = slText.match(/\d+/) ? parseInt(slText.match(/\d+/)[0], 10) : fallbackCounter;
    const sectionName = $(s.sectionName).text().trim();
    const tag = getTagForQuestion(sectionName, qNum);

    const rawComprehension = $container.find(s.comprehension).html()?.trim();
    const rawQuestionBody = $container.find(s.questionBody).html()?.trim();
    const rawSolution = $container.find(s.solution).html()?.trim();

    const rawOptions = [];
    $container.find(s.optionContainer).each((_, el) => {
      rawOptions.push($(el).find(s.optionText).html()?.trim());
    });

    const sanitizedComprehension = await transformAndSanitizeHtml(rawComprehension);
    const sanitizedQuestionBody = await transformAndSanitizeHtml(rawQuestionBody);
    const sanitizedSolution = await transformAndSanitizeHtml(rawSolution);
    const sanitizedOptions = await Promise.all(rawOptions.map(opt => transformAndSanitizeHtml(opt)));

    let finalQuestionHtml = sanitizedQuestionBody;
    if (sanitizedComprehension) finalQuestionHtml = `${sanitizedComprehension}<br><br><strong><u>Question</u></strong><br>${sanitizedQuestionBody}`;

    const correctAnswerIndex = $container.find(s.optionContainer).filter(`.${s.correctOptionClass}`).index();
    if (!finalQuestionHtml || sanitizedOptions.length === 0) { log.warn(`Invalid data for question #${qNum}`); return null; }

    return {
      noteId, SL: serialNumber, Question: finalQuestionHtml,
      OP1: sanitizedOptions[0] || null, OP2: sanitizedOptions[1] || null,
      OP3: sanitizedOptions[2] || null, OP4: sanitizedOptions[3] || null,
      Answer: correctAnswerIndex !== -1 ? correctAnswerIndex + 1 : 0,
      Solution: sanitizedSolution, Tags: tag ? [tag] : []
    };
  } catch (e) {
    log.error('Error parsing question.'); log.error(e); return null;
  }
}

// --------------------- Main Function ---------------------
async function main() {
  program
    .option('-l, --link <url>', 'Full URL to analysis page')
    .option('-c, --count <number>', 'Number of questions to scrape')
    .option('-t, --tag <tag>', 'Common tag for all questions')
    .option('-s, --skip <number>', 'Skip first N questions', '0')
    .parse(process.argv);

  const options = program.opts();
  if (!options.link) { consoleLog.error('The --link argument is required.'); process.exit(1); }

  const url = options.link;
  const scrapeLimit = options.count ? parseInt(options.count, 10) : Infinity;
  const commonTag = options.tag;
  const skipCount = parseInt(options.skip, 10);

  consoleLog.action(`Opening URL: ${url}`);
  if (scrapeLimit !== Infinity) consoleLog.info(`Scraping limited to ${scrapeLimit} questions.`);

  let browserClient, tabClient, logger, sanitizedExamName;

  try {
    browserClient = await CDP();
    consoleLog.success('Connected to browser.');
    const { Target } = browserClient;
    const { targetId } = await Target.createTarget({ url: 'about:blank' });
    tabClient = await CDP({ target: targetId });
    consoleLog.success(`Connected to new tab: ${targetId}`);

    const { Page, Runtime, Input } = tabClient;
    await Promise.all([Page.enable(), Runtime.enable()]);

    for (let i = 1; i <= 3; i++) {
      try {
        consoleLog.action(`Navigating to URL (Attempt ${i}/3)...`);
        await Page.navigate({ url, timeout: 60000 });
        await Page.loadEventFired();
        consoleLog.success('Page loaded.');
        break;
      } catch (err) {
        consoleLog.warn(`Attempt ${i} failed: ${err.message}`);
        if (i < 3) await randomDelay(4000, 6000);
        else throw err;
      }
    }

    try {
      consoleLog.action('Waiting for page content...');
      await waitForSelector(Runtime, selectors.parser.examName, 10000);
      await waitForSelector(Runtime, selectors.scraper.solutionsButton, 10000);
    } catch (err) {
      consoleLog.error('Critical setup failed. Elements not found.');
      process.exit(1);
    }

    const html = (await Runtime.evaluate({ expression: 'document.documentElement.outerHTML' })).result.value;
    const $ = cheerio.load(html);
    const examTitle = $(selectors.parser.examName).text().trim();
    if (!examTitle) { consoleLog.error('Exam title not found.'); process.exit(1); }
    sanitizedExamName = examTitle.replace(/: /g, ' - ').replace(/[<>:"/\\|?*]/g, '');

    const logFilePath = path.join('logs', 'scraped', `${sanitizedExamName}.log`);
    logger = createLogger(logFilePath);
    logger.info(`Exam: ${examTitle}`);
    if (commonTag) logger.info(`Common tag: ${commonTag}`);

    logger.action('Clicking Solutions button...');
    await humanClick(Runtime, Input, selectors.scraper.solutionsButton);
    await Page.loadEventFired();
    logger.success('Quiz interface loaded.');

    if (skipCount > 0) {
      logger.action(`Skipping first ${skipCount} questions...`);
      for (let i = 0; i < skipCount; i++) {
        const exists = await Runtime.evaluate({ expression: `!!document.querySelector('${selectors.scraper.nextButton}')` });
        if (!exists.result.value) break;
        await humanClick(Runtime, Input, selectors.scraper.nextButton);
        await randomDelay(500, 800);
      }
      logger.success('Skipped questions.');
    }

    // ---------------- Scraping Loop ----------------
    const allData = [];
    let qCounter = skipCount + 1;
    let noteId = 1000 + skipCount;
    let serial = 1;

    while (true) {
      logger.action(`Processing question #${qCounter}`);
      await smoothScroll(Runtime);
      // FASTER: Significantly reduced main "thinking" pause
      await randomDelay(800, 1200);

      await humanClick(Runtime, Input, selectors.scraper.viewSolutionButton);
      // FASTER: Reduced wait for solution to appear
      await randomDelay(700, 1000);

      const { result } = await Runtime.evaluate({ expression: 'document.documentElement.outerHTML' });
      const qData = await scrapeSingleQuestionPage(result.value, qCounter, logger, noteId, serial);
      if (qData) {
        if (commonTag) qData.Tags.push(commonTag);
        allData.push(qData);
        serial++;
        logger.success(`Scraped Question SL #${qData.SL}`);
      } else logger.warn(`Failed to scrape question #${qCounter}`);

      if (allData.length >= scrapeLimit) { logger.info('Reached scrape limit.'); break; }

      const nextExists = await Runtime.evaluate({ expression: `!!document.querySelector('${selectors.scraper.nextButton}')` });
      if (!nextExists.result.value) break;

      await humanClick(Runtime, Input, selectors.scraper.nextButton);
      qCounter++;
      noteId++;
      
      // FASTER: Removed the long periodic break
      // FASTER: Shortened the post-"Next" delay
      await randomDelay(300, 600);

      const reachedEnd = await Runtime.evaluate({ expression: `document.body.innerText.includes('You have reached the last question.')` });
      if (reachedEnd.result.value) break;
    }

    if (allData.length > 0) {
      const outDir = path.join('output', 'scraped');
      fs.mkdirSync(outDir, { recursive: true });
      const filePath = path.join(outDir, `${sanitizedExamName}.json`);
      fs.writeFileSync(filePath, JSON.stringify(allData, null, 2));
      logger.success(`Scraping completed! Saved ${allData.length} questions to ${filePath}`);
    } else logger.warn('No data scraped.');

  } catch (err) {
    const log = logger || consoleLog;
    log.error('Critical error in main process.');
    log.error(err);
    process.exit(1);
  } finally {
    if (tabClient) await tabClient.close();
    if (browserClient) await browserClient.close();
    if (logger) logger.close();
    consoleLog.info('Connections closed.');
  }
}

main();