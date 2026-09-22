const { planActions } = require('./automation/planner');

async function test() {
  console.log('Testing Fuli Action Planner with Gemini Flash...');
  const prompt = 'Go to Google and search artificial intelligence breakthroughs';
  console.log(`Prompt: "${prompt}"\n`);

  try {
    const plan = await planActions(prompt);
    console.log('Generated Plan:');
    console.log(JSON.stringify(plan, null, 2));
    console.log('\nPlanner test PASSED!');
  } catch (err) {
    console.error('Planner test FAILED:', err);
  }
}

test();
