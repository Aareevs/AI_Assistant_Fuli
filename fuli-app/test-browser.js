const { browserController } = require('./automation/browser');

async function test() {
  console.log('Testing Playwright Browser Controller...');
  try {
    console.log('1. Navigating to Google...');
    await browserController.navigate('https://www.google.com');

    console.log('2. Typing search query...');
    await browserController.type("textarea[name='q'], input[name='q']", 'AI assistant Fuli automation', true);

    console.log('3. Waiting to view results...');
    await browserController.wait(3000);

    console.log('4. Closing browser...');
    await browserController.close();

    console.log('Browser test PASSED!');
  } catch (err) {
    console.error('Browser test FAILED:', err);
    await browserController.close();
  }
}

test();
