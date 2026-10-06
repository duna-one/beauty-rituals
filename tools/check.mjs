import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Dunaa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = path.join(root, 'index.html');
const artifactsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'artifacts');
const fileUrl = pathToFileURL(htmlPath);
const expectedSources = [
  'fruit-fusion.jpg',
  'fruit-mood.jpg',
  'matcha-twist.jpg',
  'sweet-bubble.jpg',
  'mango-mania-shower.jpg',
  'mango-mania-lotion.jpg',
  'gold-set-shampoo.jpg',
  'gold-set-conditioner.jpg',
  'shower-oil.jpg',
  'mist-soft-powder-touch.jpg',
  'mist-sun-kissed-mango.jpg',
  'mist-warm-gourmet-sense.jpg',
];
const failures = [];
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'small-mobile', width: 320, height: 700 },
];

function pathToFileURL(filePath) {
  return new URL(`file:///${filePath.replaceAll('\\', '/')}`);
}

function assert(condition, message) {
  if (!condition) failures.push(new Error(message));
}

async function checkOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  assert(dimensions.documentWidth <= dimensions.innerWidth, `${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
}

async function checkCardsAndDetails(page, label) {
  const cardCount = await page.locator('.product-card').count();
  const detailsCount = await page.locator('details').count();
  assert(cardCount === 12, `${label}: expected 12 .product-card elements, found ${cardCount}`);
  assert(detailsCount === 12, `${label}: expected 12 details elements, found ${detailsCount}`);

  const details = page.locator('details');
  for (let i = 0; i < detailsCount; i += 1) {
    const item = details.nth(i);
    const summary = item.locator('summary');
    assert(await summary.count() === 1, `${label}: details ${i + 1} must have one summary`);
    await summary.click();
    assert(await item.evaluate((element) => element.open), `${label}: details ${i + 1} did not open by clicking summary`);
    await checkOverflow(page, `${label}: details ${i + 1} open`);
    await summary.click();
    assert(!(await item.evaluate((element) => element.open)), `${label}: details ${i + 1} did not close by clicking summary`);
  }
}

async function visitAllProductImages(page, label, shouldLoad) {
  const visuals = page.locator('.product-visual');
  const count = await visuals.count();
  for (let i = 0; i < count; i += 1) {
    await visuals.nth(i).scrollIntoViewIfNeeded();
    await page.waitForFunction(({ index, shouldLoad }) => {
      const current = document.querySelectorAll('.product-visual img[src]')[index];
      if (!current || !current.complete) return false;
      return shouldLoad ? current.naturalWidth > 0 : current.naturalWidth === 0;
    }, { index: i, shouldLoad }, { timeout: 15000 });
  }
  console.log(`${label}: visited ${count} product visuals; images ${shouldLoad ? 'loaded' : 'failed to placeholders'}.`);
}

async function checkImageStates(page, label, shouldLoad) {
  const images = page.locator('.product-visual img[src]');
  const count = await images.count();
  assert(count === 12, `${label}: expected 12 product images, found ${count}`);
  for (let i = 0; i < count; i += 1) {
    const image = images.nth(i);
    const info = await image.evaluate(async (element) => {
      if (element instanceof HTMLImageElement && !element.complete) {
        await new Promise((resolve) => {
          element.addEventListener('load', resolve, { once: true });
          element.addEventListener('error', resolve, { once: true });
          setTimeout(resolve, 5000);
        });
      }
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
      const loaded = element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0;
      const visual = element.closest('.product-visual');
      const placeholder = visual?.querySelector('.product-placeholder');
      const placeholderVisible = !!placeholder && !placeholder.hidden && getComputedStyle(placeholder).display !== 'none' && getComputedStyle(placeholder).visibility !== 'hidden';
      const hasImageClass = visual?.classList.contains('has-image') ?? false;
      return { src: element.getAttribute('src'), visible, loaded, placeholderVisible, hasImageClass };
    });
    if (shouldLoad) {
      assert(info.visible && info.loaded && info.hasImageClass && !info.placeholderVisible, `${label}: image ${i + 1} must have loaded and be visible; got ${JSON.stringify(info)}`);
    } else {
      assert(!info.visible && info.placeholderVisible && !info.hasImageClass, `${label}: failed image ${i + 1} must be hidden with a visible placeholder; got ${JSON.stringify(info)}`);
    }
  }
}

async function checkPhotoWindows(page, label) {
  const frames = page.locator('.photo-window');
  const count = await frames.count();
  assert(count === 12, `${label}: expected 12 .photo-window frames, found ${count}`);
  for (let i = 0; i < count; i += 1) {
    const frame = frames.nth(i);
    const rects = await frame.evaluate((element) => {
      const r = element.getBoundingClientRect();
      const p = element.closest('.product-visual')?.getBoundingClientRect();
      return {
        frame: { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
        visual: p && { x: p.x, y: p.y, right: p.right, bottom: p.bottom, width: p.width, height: p.height },
      };
    });
    assert(rects.frame.width > 0 && rects.frame.height > 0, `${label}: photo-window ${i + 1} has an empty rect ${JSON.stringify(rects.frame)}`);
    assert(rects.visual && rects.frame.x >= rects.visual.x - 1 && rects.frame.y >= rects.visual.y - 1 && rects.frame.right <= rects.visual.right + 1 && rects.frame.bottom <= rects.visual.bottom + 1, `${label}: photo-window ${i + 1} exceeds product-visual bounds ${JSON.stringify(rects)}`);
  }
}

async function assertExpectedSources(page) {
  assert(expectedSources.length === 12, 'The expected specification list must contain 12 image filenames.');
  const actual = await page.locator('.product-visual img[src]').evaluateAll((images) => images.map((image) => {
    const src = image.getAttribute('src') ?? '';
    return decodeURIComponent(src.split(/[\\/]/).at(-1));
  }));
  const expectedSorted = [...expectedSources].map((source) => decodeURIComponent(source.split(/[\\/]/).at(-1))).sort();
  const actualSorted = [...actual].sort();
  assert(JSON.stringify(actualSorted) === JSON.stringify(expectedSorted), `Image source filenames differ. Expected ${JSON.stringify(expectedSorted)}, found ${JSON.stringify(actualSorted)}`);
}

await mkdir(artifactsPath, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(fileUrl.href, { waitUntil: 'load' });
    assert(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), `${viewport.name}: reduced-motion preference was not applied`);
    await assertExpectedSources(page);
    await checkCardsAndDetails(page, viewport.name);
    await visitAllProductImages(page, viewport.name, true);
    await checkOverflow(page, viewport.name);
    await checkImageStates(page, viewport.name, true);
    await checkPhotoWindows(page, viewport.name);
    if (viewport.name === 'desktop' || viewport.name === 'mobile') {
      await page.screenshot({ path: path.join(artifactsPath, `${viewport.name}.png`), fullPage: true });
    }
    if (viewport.name === 'mobile') {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(artifactsPath, 'mobile-hero.png'), fullPage: false });
      await page.locator('#fruit-fusion').scrollIntoViewIfNeeded();
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(artifactsPath, 'mobile-product.png'), fullPage: false });
      await page.locator('#mists').scrollIntoViewIfNeeded();
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(artifactsPath, 'mobile-mists.png'), fullPage: false });
    }

    const failedImages = [];
    await page.route('**/*', async (route) => {
      if (route.request().resourceType() === 'image') {
        failedImages.push(route.request().url());
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await page.reload({ waitUntil: 'load' });
    await visitAllProductImages(page, `${viewport.name} aborted images`, false);
    await checkImageStates(page, `${viewport.name} aborted images`, false);
    assert(failedImages.length > 0, `${viewport.name}: image abort route did not intercept any images`);
    await checkCardsAndDetails(page, `${viewport.name} fallback`);
    assert(pageErrors.length === 0, `${viewport.name}: pageerror events: ${pageErrors.join('; ')}`);
    await context.close();
  }

  const noJsContext = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false, reducedMotion: 'reduce' });
  const noJsPage = await noJsContext.newPage();
  await noJsPage.goto(fileUrl.href, { waitUntil: 'load' });
  assert(await noJsPage.locator('.product-card').count() === 12, 'JavaScript disabled: product content is not visible');
  assert(await noJsPage.locator('.product-card').first().isVisible(), 'JavaScript disabled: first product card is hidden');
  assert(await noJsPage.locator('details').count() === 12, 'JavaScript disabled: details content is not visible');
  await checkOverflow(noJsPage, 'JavaScript disabled mobile');
  await noJsContext.close();
} catch (error) {
  failures.push(error);
} finally {
  await browser.close();
}

if (failures.length) {
  const uniqueFailures = [...new Set(failures.map((error) => error.message.replace(/details \d+ open/g, 'details open')))];
  console.error(`FAIL: ${uniqueFailures.length} unique assertion(s); ${failures.length} total occurrence(s).`);
  for (const message of uniqueFailures) console.error(`- ${message}`);
  process.exitCode = 1;
} else {
  console.log('PASS: all viewport, detail, image, fallback, reduced-motion, and JavaScript-disabled checks completed.');
}

const imageFiles = await Promise.all(expectedSources.map(async (filename) => ({
  filename,
  bytes: (await stat(path.join(root, 'images', filename))).size,
})));
await writeFile(path.join(artifactsPath, 'validation.json'), `${JSON.stringify({
  status: failures.length ? 'FAIL' : 'PASS',
  checkedAt: new Date().toISOString(),
  entry: 'index.html',
  browser: 'Google Chrome headless via Playwright',
  viewports: viewports.map(({ name, width, height }) => ({ name, width, height })),
  productImages: { expected: 12, loadedAndVisible: failures.length ? null : 12, files: imageFiles },
  checks: ['exact image filenames', 'all product images load', 'photo-window geometry', '12 cards and details', 'details click open and close', 'no horizontal overflow including open details', 'image request fallback', 'no pageerror', 'reduced motion', 'content visible with JavaScript disabled'],
  screenshots: ['desktop.png', 'mobile.png', 'mobile-hero.png', 'mobile-product.png', 'mobile-mists.png'],
  failures: failures.map((error) => error.message),
}, null, 2)}\n`, 'utf8');
