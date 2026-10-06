// Stands in for Claude Code / Codex: reads the prompt on stdin, then designs through the planner tools.
const [url, projectId, actor] = process.argv.slice(2);
let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) prompt += chunk;
console.log(`got prompt with ${prompt.includes(projectId) ? 'project id' : 'NO project id'}`);
const call = async (name, input) => {
  const response = await fetch(`${url}/api/tools/${name}`, {
    method: 'POST',
    // The run's own key, handed over by the app; it stops working when the run ends.
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.PLANNER_TOKEN}` },
    body: JSON.stringify({ input: { project_id: projectId, ...input }, actor }),
  });
  return response.json();
};
await call('set_room', { width_m: 12, depth_m: 9, ceiling_m: 3.2, summary: 'قاعة ١٢×٩' });
const result = await call('place_items', {
  items: [
    { definition_id: 'table-180', x_m: 4, y_m: 5 },
    { definition_id: 'chair', x_m: 3.5, y_m: 4.2 },
    { definition_id: 'chair', x_m: 4.5, y_m: 4.2 },
  ],
  summary: 'ترابيزة وكرسيين',
});
console.log(result.text.split('\n')[0]);
process.stdout.write(`token-ends-with-run: ${Boolean(process.env.PLANNER_TOKEN)}\n`);
