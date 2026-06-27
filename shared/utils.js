/**
 * utils.js
 * Shared utility functions used across content scripts
 */

/**
 * Extract ASIN from an Amazon product URL
 * @param {string} url - Amazon product URL
 * @returns {string|null} - 10-character ASIN or null if not found
 */
function extractASIN(url) {
  const match = url.match(/\/dp\/([A-Z0-9]{10})/);
  return match ? match[1] : null;
}

/**
 * Month name to zero-indexed month number mapping
 */
const MONTH_MAP = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11
};

/**
 * Parse "Month Day" format and infer the year
 * @param {string} monthDay - Date string like "April 9" or "Jun 23"
 * @returns {Date|null} - Parsed date with inferred year, or null if unparseable
 */
function inferYear(monthDay) {
  const match = monthDay.match(/(\w+)\s+(\d+)/);
  if (!match) return null;

  const [, monthName, day] = match;
  const month = MONTH_MAP[monthName.toLowerCase()];
  if (month === undefined) return null;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  // If delivery month is in the future, assume it's from previous year
  // (e.g., seeing "December 15" in January means last year)
  const year = month > currentMonth ? currentYear - 1 : currentYear;

  return new Date(year, month, parseInt(day, 10));
}

/**
 * Check if current page is Amazon Vine orders page
 * @returns {boolean}
 */
function isVineOrdersPage() {
  return window.location.href.includes('/vine/orders');
}

/**
 * Check if current page is Amazon account orders page
 * @returns {boolean}
 */
function isYourOrdersPage() {
  const url = window.location.href;
  return url.includes('/your-orders') ||
         url.includes('/order-history') ||
         url.includes('/gp/your-account/order-history') ||
         url.includes('/gp/css/order-history');
}
