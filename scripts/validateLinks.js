import { readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const rootDir = path.resolve(__dirname, '..');
const linksPath = path.join(rootDir, 'links.json');
const scrapedDir = path.join(rootDir, 'output', 'scraped');
const taggedDir = path.join(rootDir, 'output', 'tagged');

// Helper to check if file exists in either folder
async function fileExists(fileName) {
  const scrapedFile = path.join(scrapedDir, fileName);
  const taggedFile = path.join(taggedDir, fileName);

  try {
    await access(scrapedFile, constants.F_OK);
    return true;
  } catch {
    try {
      await access(taggedFile, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

// Main function
async function validateLinks() {
  try {
    const rawData = await readFile(linksPath, 'utf-8');
    const links = JSON.parse(rawData);

    let updated = false;

    const updatedLinks = await Promise.all(
      links.map(async entry => {
        if (entry.Status === 'COMPLETED' && entry.File) {
          const exists = await fileExists(entry.File);
          if (!exists) {
            console.log(`⚠️ File not found: ${entry.File} — marking as PENDING`);
            entry.Status = 'PENDING';
            entry.File = '';
            updated = true;
          }
        }
        return entry;
      })
    );

    if (updated) {
      await writeFile(linksPath, JSON.stringify(updatedLinks, null, 2), 'utf-8');
      console.log('✅ links.json updated successfully.');
    } else {
      console.log('✅ All files are present. No changes made.');
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

// Run the script
validateLinks();