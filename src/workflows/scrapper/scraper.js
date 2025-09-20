// src/workflows/scrapper/scraper.js

import CDP from 'chrome-remote-interface';
import { program } from 'commander';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { selectors } from './utils/selectors.js';
import { transformAndSanitizeHtml } from './utils/sanitizer.js';

// A simple logging utility for initial console output before the file logger is ready.
const consoleLog = {
  action: (msg) => console.log(`[*] ${msg}`),
  info: (msg) => console.log(`[i] ${msg}`),
  success: (msg) => console.log(`[✓] ${msg}`),
  warn: (msg) => console.log(`[?] ${msg}`),
  error: (msg) => console.error(`[x] ${msg}`),
};

/**
 * Creates a comprehensive logger that writes to both the console and a specified log file.
 * @param {string} logFilePath - The full path to the log file.
 * @returns {object} A logger object with methods for different log levels.
 */
function createLogger(logFilePath) {
  const logDir = path.dirname(logFilePath);
  fs.mkdirSync(logDir, { recursive: true });
  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  const formatFileMessage = (level, msg) => {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] ${msg}\n`;
  };
  const logger = {
    action: (msg) => { console.log(`[*] ${msg}`); logStream.write(formatFileMessage('action', msg)); },
    info: (msg) => { console.log(`[i] ${msg}`); logStream.write(formatFileMessage('info', msg)); },
    success: (msg) => { console.log(`[✓] ${msg}`); logStream.write(formatFileMessage('success', msg)); },
    warn: (msg) => { console.log(`[?] ${msg}`); logStream.write(formatFileMessage('warn', msg)); },
    error: (msg) => {
      const message = (msg instanceof Error) ? (msg.stack || msg.toString()) : msg;
      console.error(`[x] ${message}`);
      logStream.write(formatFileMessage('error', message));
    },
    close: () => { logStream.end(); }
  };
  return logger;
}

/**
 * Creates a promise that resolves after a specified delay.
 * @param {number} ms - The delay in milliseconds.
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise(res => setTimeout(res, ms));

// Custom Error class for timeouts
class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Waits for a specific element to appear in the DOM.
 * Polls the page until the selector is found or the timeout is reached.
 * @param {object} Runtime - The CDP Runtime protocol client.
 * @param {string} selector - The CSS selector to wait for.
 * @param {number} timeout - Maximum time to wait in milliseconds.
 * @returns {Promise<void>} Resolves when the element is found, rejects on timeout.
 */
async function waitForSelector(Runtime, selector, timeout) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const { result } = await Runtime.evaluate({
      expression: `document.querySelector('${selector}') !== null`,
    });
    if (result.value) {
      return; // Selector found, success!
    }
    await delay(250); // Wait a bit before checking again
  }
  throw new TimeoutError(`Timeout: Waited ${timeout}ms for selector "${selector}" to appear.`);
}


/**
 * Determines the subject tag for a question based on a set of hierarchical rules.
 * @param {string} sectionName - The name of the section from the webpage.
 * @param {number} questionNumber - The serial number (SL) of the question within its section.
 * @returns {string|null} The determined tag (e.g., 'MATH', 'GI') or null if no rule matches.
 */
function getTagForQuestion(sectionName, questionNumber) {
  if (!sectionName || typeof questionNumber !== 'number') {
    return null;
  }
  
  const trimmedSection = sectionName.trim();

  // 1. Special Override Rules (Highest Priority)
  if (trimmedSection === "Section I") {
    if (questionNumber >= 1 && questionNumber <= 30) return 'MATH';
    if (questionNumber >= 31 && questionNumber <= 60) return 'GI';
  }
  if (trimmedSection === "Section II") {
    if (questionNumber >= 1 && questionNumber <= 45) return 'ENG';
    if (questionNumber >= 46 && questionNumber <= 70) return 'GK';
  }

  // 2. Simplified General Fallback Rules
  const lowerCaseSection = trimmedSection.toLowerCase();
  if (lowerCaseSection.includes("quantitative") || lowerCaseSection.includes("quants")) return 'MATH';
  if (lowerCaseSection.includes("intelligence") || lowerCaseSection.includes("reasoning")) return 'GI';
  if (lowerCaseSection.includes("english")) return 'ENG';
  if (lowerCaseSection.includes("awareness") || lowerCaseSection.includes("knowledge")) return 'GK';
  if (lowerCaseSection.includes("computer")) return 'COMPUTER';
  if (lowerCaseSection.includes("bengali")) return 'BENGALI';

  // 3. No Match Found
  return null;
}

/**
 * Parses, SANITIZES, and extracts details for a single question.
 * @param {string} html - The HTML string of the page to be scraped.
 * @param {number} fallbackCounter - A counter to use if the question number cannot be read from the page.
 * @param {object} log - The logger instance.
 * @param {number} noteId - The unique ID for the note.
 * @param {number} serialNumber - The sequential serial number (SL) for the question.
 * @returns {Promise<object|null>} A promise that resolves to the question data object.
 */
async function scrapeSingleQuestionPage(html, fallbackCounter, log, noteId, serialNumber) {
  try {
    const $ = cheerio.load(html);
    const s = selectors.parser;
    const $container = $(s.activeQuestionContainer);

    if ($container.length === 0) {
      log.warn('Active question container not found. Skipping.');
      return null;
    }

    const $questionNumberElement = $container.find(s.questionNumber);
    const $clonedElement = $questionNumberElement.clone();
    $clonedElement.find('span.hidden-xs').remove();
    const slText = $clonedElement.text().trim();
    const slMatch = slText.match(/\d+/);
    // This number is scraped from the page and used specifically for tag detection.
    const questionNumberForTagging = slMatch ? parseInt(slMatch[0], 10) : fallbackCounter;
    
    const sectionName = $(s.sectionName).text().trim();
    // Use the scraped question number for tag detection logic.
    const tag = getTagForQuestion(sectionName, questionNumberForTagging);
    
    const rawComprehension = $container.find(s.comprehension).html()?.trim();
    const rawQuestionBody = $container.find(s.questionBody).html()?.trim();
    const rawSolution = $container.find(s.solution).html()?.trim();
    
    const rawOptions = [];
    const $options = $container.find(s.optionContainer);
    $options.each((_, element) => {
      rawOptions.push($(element).find(s.optionText).html()?.trim());
    });

    const sanitizedComprehension = await transformAndSanitizeHtml(rawComprehension);
    const sanitizedQuestionBody = await transformAndSanitizeHtml(rawQuestionBody);
    const sanitizedSolution = await transformAndSanitizeHtml(rawSolution);
    const sanitizedOptions = await Promise.all(
      rawOptions.map(opt => transformAndSanitizeHtml(opt))
    );

    let finalQuestionHtml = sanitizedQuestionBody;
    if (sanitizedComprehension) {
      // Use a formatted header instead of a horizontal rule (<hr>).
      finalQuestionHtml = `${sanitizedComprehension}<br><br><strong><u>Question</u></strong><br>${sanitizedQuestionBody}`;
    }

    const $correctOption = $options.filter(`.${s.correctOptionClass}`);
    const correctAnswerIndex = $correctOption.index();

    if (!finalQuestionHtml || sanitizedOptions.length === 0) {
      log.warn(`Could not find valid data for question on page #${questionNumberForTagging} after sanitization.`);
      return null;
    }

    const finalQuestionData = {
      noteId,
      SL: serialNumber, // Use the passed-in sequential counter for the SL field.
      Question: finalQuestionHtml,
      OP1: sanitizedOptions[0] || null,
      OP2: sanitizedOptions[1] || null,
      OP3: sanitizedOptions[2] || null,
      OP4: sanitizedOptions[3] || null,
      Answer: correctAnswerIndex !== -1 ? correctAnswerIndex + 1 : 0,
      Solution: sanitizedSolution,
      Tags: tag ? [tag] : []
    };
    
    return finalQuestionData;

  } catch (e) {
    log.error('Error during Cheerio parsing or sanitization.');
    log.error(e);
    return null;
  }
}

/**
 * Main function to orchestrate the scraping process.
 */
async function main() {
  program
    .option('-l, --link <url>', 'The full URL to the analysis page')
    .option('-c, --count <number>', 'The number of questions to scrape (optional)')
    .option('-t, --tag <tag>', 'A common tag to add to all scraped questions')
    .option('-s, --skip <number>', 'Skip the first N questions before scraping', '0')
    .parse(process.argv);

  const options = program.opts();
  if (!options.link) { consoleLog.error('The --link argument is required.'); process.exit(1); }
  
  const urlToOpen = options.link;
  const scrapeLimit = options.count ? parseInt(options.count, 10) : Infinity;
  const commonTag = options.tag;
  const questionsToSkip = parseInt(options.skip, 10);

  consoleLog.action(`Attempting to open URL: ${urlToOpen}`);
  if (scrapeLimit !== Infinity) { consoleLog.info(`Scraping will be limited to ${scrapeLimit} question(s).`); }

  let sanitizedExamName = 'scraped_quiz_data';
  let browserClient;
  let tabClient;
  let logger;

  try {
    browserClient = await CDP();
    consoleLog.success('Connected to the browser!'); 
    const { Target } = browserClient;
    const { targetId } = await Target.createTarget({ url: 'about:blank' });
    tabClient = await CDP({ target: targetId });
    consoleLog.success(`Connected to new tab: ${targetId}`);

    const { Page, Runtime } = tabClient;
    await Promise.all([Page.enable(), Runtime.enable()]);

    const maxRetries = 3;
    for (let i = 1; i <= maxRetries; i++) {
      try {
        consoleLog.action(`Attempting to navigate to URL (Attempt ${i}/${maxRetries})...`);
        await Page.navigate({ url: urlToOpen, timeout: 60000 });
        await Page.loadEventFired();
        consoleLog.success('Analysis page loaded successfully!');
        break;
      } catch (err) {
        consoleLog.warn(`Attempt ${i} failed: ${err.message}`);
        if (i < maxRetries) {
          consoleLog.info('Retrying in 5 seconds...');
          await delay(5000);
        } else {
          consoleLog.error('All navigation attempts failed. Exiting.');
          throw err;
        }
      }
    }

    try {
        consoleLog.action('Waiting for analysis page content to render (10s timeout)...');
        // Wait up to 10s for the title
        await waitForSelector(Runtime, selectors.parser.examName, 10000);
        consoleLog.success('Exam name element found.');
        // Wait up to 10s for the button
        await waitForSelector(Runtime, selectors.scraper.solutionsButton, 10000);
        consoleLog.success('Solutions button found.');
    } catch (err) {
        if (err instanceof TimeoutError) {
            consoleLog.error('--- CRITICAL SETUP FAILED ---');
            consoleLog.error(err.message); // Log the specific timeout error
            consoleLog.error('Could not find essential page elements (Exam Name or Solutions button).');
            consoleLog.error('This may be due to a wrong link, a page layout change, or a very slow network connection.');
            consoleLog.error('Aborting scrape for this link.');
            process.exit(1); // Exit with an error code
        }
        // For any other unexpected error, re-throw it to be caught by the main handler
        throw err;
    }
    
    const analysisPageHtml = (await Runtime.evaluate({ expression: 'document.documentElement.outerHTML' })).result.value;
    const $ = cheerio.load(analysisPageHtml);
    const examTitle = $(selectors.parser.examName).text().trim();

    if (examTitle) {
      sanitizedExamName = examTitle.replace(/: /g, ' - ').replace(/[<>:"/\\|?*]/g, '');
    }

    const logFilePath = path.join('logs', 'scraped', `${sanitizedExamName}.log`);
    logger = createLogger(logFilePath);
    logger.info(`Logger initialized. Saving logs to: ${logFilePath}`);
    
    if (commonTag) { logger.info(`A common tag will be added to all questions: "${commonTag}"`); }
    if (examTitle) { logger.info(`Exam Name: ${examTitle}`); } 
    else { logger.warn('Could not find the exam title on the analysis page.'); }

    logger.action('Clicking "Solutions" button to enter quiz interface...');
    await Runtime.evaluate({ expression: `document.querySelector('${selectors.scraper.solutionsButton}').click();` });
    await Page.loadEventFired();
    logger.success('Quiz interface loaded.');

    if (questionsToSkip > 0) {
      logger.action(`--- Skipping the first ${questionsToSkip} questions as requested ---`);
      for (let i = 0; i < questionsToSkip; i++) {
        const nextButtonExists = await Runtime.evaluate({ expression: `!!document.querySelector('${selectors.scraper.nextButton}')` });
        if (!nextButtonExists.result.value) {
          logger.warn(`Could not find the 'Next' button while skipping. Reached the end after skipping ${i} questions.`);
          break;
        }
        logger.info(`Skipping question ${i + 1}/${questionsToSkip}...`);
        await Runtime.evaluate({ expression: `document.querySelector('${selectors.scraper.nextButton}').click();` });
        await delay(1000);
      }
      logger.success(`Finished skipping ${questionsToSkip} questions.`);
    }

    const allQuestionsData = [];
    let questionCounter = questionsToSkip + 1; // Tracks the question number on the page for logging/fallback
    let noteIdCounter = 1000 + questionsToSkip;
    let serialNumberCounter = 1; // New counter for the final 'SL' field, starts at 1

    // Main scraping loop.
    while (true) {
      logger.action(`--- Processing Question on page #${questionCounter} ---`);
      await delay(1500);

      await Runtime.evaluate({ expression: `document.querySelector('${selectors.scraper.viewSolutionButton}').click()` });
      await delay(1000);

      const { result } = await Runtime.evaluate({ expression: 'document.documentElement.outerHTML' });
      const currentQuestionData = await scrapeSingleQuestionPage(result.value, questionCounter, logger, noteIdCounter, serialNumberCounter);
      
      if (currentQuestionData) {
        if (commonTag) { currentQuestionData.Tags.push(commonTag); }
        allQuestionsData.push(currentQuestionData);
        // On success, increment the SL counter for the next question.
        serialNumberCounter++;
        logger.success(`Scraped data for Question SL #${currentQuestionData.SL} (Note ID: ${currentQuestionData.noteId})`);
      } else {
        logger.warn(`Could not parse data for question on page #${questionCounter}.`);
      }

      if (allQuestionsData.length >= scrapeLimit) {
        logger.info(`Reached scrape limit of ${scrapeLimit} question(s). Ending loop.`);
        break;
      }

      const nextButtonExists = await Runtime.evaluate({ expression: `!!document.querySelector('${selectors.scraper.nextButton}')` });
      if (!nextButtonExists.result.value) {
        logger.info('Next button not found. Assuming this is the last question. Ending scrape loop.');
        break;
      }
      logger.action('Clicking "Next" question...');
      await Runtime.evaluate({ expression: `document.querySelector('${selectors.scraper.nextButton}').click();` });
      
      questionCounter++;
      noteIdCounter++;
      
      await delay(500);
      const reachedEndText = await Runtime.evaluate({
        expression: `document.body.innerText.includes('You have reached the last question. Do you want to navigate to first question')`
      });
      if (reachedEndText.result.value) {
        logger.info('Detected the "You have reached the last question" message. Ending scrape loop.');
        break;
      }
    }

    if (allQuestionsData.length > 0) {
      const outputDir = path.join('output', 'scraped');
      fs.mkdirSync(outputDir, { recursive: true });
      
      const fileName = `${sanitizedExamName}.json`;
      const filePath = path.join(outputDir, fileName);

      fs.writeFileSync(filePath, JSON.stringify(allQuestionsData, null, 2));
      logger.success(`All data saved to ${filePath}! Total questions scraped: ${allQuestionsData.length}`);
    } else {
      logger.warn('Scraping finished, but no data was collected.');
    }

  } catch (err) {
    const log = logger || consoleLog;
    log.error('A critical error occurred in the main process.');
    log.error(err);
    process.exit(1); 
  } finally {
    if (tabClient) await tabClient.close();
    if (browserClient) await browserClient.close();
    if (logger) logger.close();
    consoleLog.info('All connections closed.');
  }
}

main();