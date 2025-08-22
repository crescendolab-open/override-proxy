import { rule } from '../utils.js';

// Simple demo endpoint to verify rules loading works while /rules is gitignored except this file.
export default rule('GET', '/__demo/hello', (_req, res) => {
  res.json({ message: 'hello', ts: new Date().toISOString() });
}, { name: 'DemoHello' });
