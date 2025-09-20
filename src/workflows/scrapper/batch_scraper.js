// src/workflows/scrapper/batch_scraper.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execa } from 'execa'; // Import execa instead of spawn

// --- PATH RESOLUTION FOR NESTED LOCATION ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

const LINKS_FILE_PATH = path.join(PROJECT_ROOT, 'links.json');
const SCRAPER_SCRIPT_PATH = path.join(__dirname, 'scraper.js');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output', 'scraped');
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');

// Simple logger for the batch scraper
const log = {
  action: (msg) => console.log(`\n[⚙️ BATCH] [*] ${msg}`),
  info: (msg) => console.log(`[⚙️ BATCH] [i] ${msg}`),
  success: (msg) => console.log(`[⚙️ BATCH] [✓] ${msg}`),
  error: (msg) => console.error(`[⚙️ BATCH] [x] ${msg}`),
  warn: (msg) => console.log(`[⚙️ BATCH] [?] ${msg}`),
};

/**
 * Ensures that necessary directories exist before running.
 */
function setupDirectories() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        log.info(`Created output directory: ${OUTPUT_DIR}`);
    }
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
        log.info(`Created logs directory: ${LOGS_DIR}`);
    }
}

/**
 * Reads and parses the links.json file.
 * @returns {Array<object>} The array of link objects.
 */
function loadLinks() {
  try {
    if (!fs.existsSync(LINKS_FILE_PATH)) {
      log.error(`links.json file not found at: ${LINKS_FILE_PATH}`);
      process.exit(1);
    }
    const fileContent = fs.readFileSync(LINKS_FILE_PATH, 'utf-8');
    return JSON.parse(fileContent);
  } catch (err) {
    log.error('Failed to read or parse links.json.');
    log.error(err);
    process.exit(1);
  }
}

/**
 * Saves the updated array of links back to the links.json file.
 * @param {Array<object>} links - The array of link objects to save.
 */
function saveLinks(links) {
  try {
    fs.writeFileSync(LINKS_FILE_PATH, JSON.stringify(links, null, 2));
  } catch (err) {
    log.error('Failed to save updated links.json file.');
    log.error(err);
  }
}

/**
 * Finds the most recently created .json file in the output directory.
 * @returns {string|null} The name of the latest file or null if none are found.
 */
function findLatestOutputFile() {
  try {
    if (!fs.existsSync(OUTPUT_DIR)) return null;

    const files = fs.readdirSync(OUTPUT_DIR)
      .filter(file => file.endsWith('.json'))
      .map(file => ({
        file,
        time: fs.statSync(path.join(OUTPUT_DIR, file)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    return files.length > 0 ? files[0].file : null;
  } catch (err) {
    log.error('Error finding latest output file.');
    log.error(err);
    return null;
  }
}

/**
 * Executes the scraper script using execa.
 * @param {object} task - The task object from links.json.
 * @returns {Promise<boolean>} A promise that resolves to true on success, false on failure.
 */
async function runScraper(task) {
  log.action(`Starting scraper for SL: ${task.SL}, Subject: ${task.Subject}`);
  log.info(`URL: ${task.Link}`);
  
  if (!fs.existsSync(SCRAPER_SCRIPT_PATH)) {
      log.error(`Scraper script not found at: ${SCRAPER_SCRIPT_PATH}`);
      return false;
  }

  const args = [
    SCRAPER_SCRIPT_PATH,
    '--link',
    task.Link,
    '--tag',
    task.SL,
  ];

  try {
    // Await the execa promise. We use { stdio: 'inherit' } to stream the
    // scraper's output directly to our console in real-time.
    await execa('node', args, { stdio: 'inherit' });

    log.success(`Scraper finished successfully for SL: ${task.SL}`);
    return true;
  } catch (error) {
    // If the process exits with a non-zero code, execa throws an error.
    log.error(`Scraper for SL: ${task.SL} failed.`);
    // The scraper's own error output will be visible because of 'inherit'.
    // We can also log execa's summary for more context if needed.
    log.error(`Execa reported an error with exit code: ${error.exitCode}`);
    return false;
  }
}

/**
 * The main function to manage the scraping process.
 */
async function main() {
  log.info('Starting batch scraper...');
  setupDirectories();
  const allLinks = loadLinks();

  const pendingTasks = allLinks.filter(task => task.Status === 'PENDING');
  if (pendingTasks.length === 0) {
    log.success('All tasks are already completed. Nothing to do.');
    return;
  }
  
  log.info(`Found ${pendingTasks.length} pending task(s). Starting process...`);

  for (const task of allLinks) {
    if (task.Status === 'PENDING') {
      const success = await runScraper(task);

      if (success) {
        const outputFileName = findLatestOutputFile();
        task.Status = 'COMPLETED';
        if (outputFileName) {
            task.File = path.relative(PROJECT_ROOT, path.join(OUTPUT_DIR, outputFileName));
            log.success(`Updated task file to: ${task.File}`);
        } else {
            task.File = 'UNKNOWN';
            log.warn('Could not find the output file for the completed task.');
        }
      } else {
        task.Status = 'FAILED';
        task.File = '';
      }

      saveLinks(allLinks);
      log.info('Progress saved to links.json.');
    }
  }

  log.success('All pending tasks have been processed.');
}

main();