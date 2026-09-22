const { actionExecutor } = require('./automation/executor');

async function test() {
  console.log('Testing End-to-End Action Executor...\n');

  try {
    const result = await actionExecutor.executeTask(
      'Go to Google and search OpenAI o3 breakthroughs',
      (event) => {
        console.log(`[EVENT: ${event.type}]`, event.message || event.description || event.summary || '');
      }
    );

    console.log('\nTask execution result:', result);
    console.log('End-to-End Executor test PASSED!');
  } catch (err) {
    console.error('Executor test FAILED:', err);
  }
}

test();
