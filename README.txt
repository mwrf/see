See - A simple short URL redirect thing.

## Running the server

Then run the see server by running (port 80 by default):
 "node see.js <port>"

Alternatively, you can use:
 "npm start -- <port>"
 (If you add a "start": "node see.js" to package.json scripts)

## Testing

This project uses Playwright for automated end-to-end tests.

### Prerequisites

Ensure you have Node.js and npm installed.

### Setup

1. Clone the repository (if you haven't already).
2. Navigate to the project directory.
3. Install dependencies (including Playwright):
   ```bash
   npm install
   ```
   The above command installs Playwright. Playwright will download browser binaries on its first run if they are not already present (typically in `~/.cache/ms-playwright`).
   For a complete setup including OS-level dependencies for the browsers (especially useful in CI environments or fresh systems):
   ```bash
   npx playwright install --with-deps
   ```

### Running Tests

To execute the test suite:
   ```bash
   npm test
   ```
This command will automatically start the server (as configured in `playwright.config.js`) and run all tests located in the `tests` directory.
