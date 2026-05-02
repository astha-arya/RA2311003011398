import { Logger } from "../logging_middleware/dist/index.js";

interface Depot {
  ID: number;
  MechanicHours: number;
}

interface VehicleTask {
  TaskID: string;
  Duration: number;
  Impact: number;
}

function knapsack(tasks: VehicleTask[], capacity: number) {
  const n = tasks.length;
  if (n === 0 || capacity <= 0) return { selected: [], impact: 0, time: 0 };

  const stride = capacity + 1;
  const dp = new Int32Array((n + 1) * stride);

  for (let i = 1; i <= n; i++) {
    const t = tasks[i - 1];
    const weight = Math.ceil(t.Duration);
    const val = t.Impact;
    for (let j = 0; j <= capacity; j++) {
      const prev = dp[(i - 1) * stride + j];
      if (weight <= j) {
        dp[i * stride + j] = Math.max(prev, dp[(i - 1) * stride + (j - weight)] + val);
      } else {
        dp[i * stride + j] = prev;
      }
    }
  }

  const selected: string[] = [];
  let rem = capacity;
  for (let i = n; i >= 1 && rem > 0; i--) {
    if (dp[i * stride + rem] !== dp[(i - 1) * stride + rem]) {
      const t = tasks[i - 1];
      selected.push(t.TaskID);
      rem -= Math.ceil(t.Duration);
    }
  }
  return { selected, impact: dp[n * stride + capacity], time: capacity - rem };
}

async function main() {
  const token = process.env.BEARER_TOKEN?.trim() || "";
  Logger.init({ bearerToken: token });

  try {
    await Logger.info("backend", "service", "Fetching scheduler data");

    const [dRes, vRes] = await Promise.all([
      fetch("http://20.207.122.201/evaluation-service/depots", { headers: { Authorization: `Bearer ${token}` }}),
      fetch("http://20.207.122.201/evaluation-service/vehicles", { headers: { Authorization: `Bearer ${token}` }})
    ]);

    const dData = await dRes.json() as any;
    const vData = await vRes.json() as any;

    const depots: Depot[] = dData.depots || [];
    // FIX: The API returns a flat list of tasks in the "vehicles" array
    const allTasks: VehicleTask[] = vData.vehicles || [];

    console.log(`\n\x1b[1m\x1b[36m══ Vehicle Maintenance Schedule ══\x1b[0m`);

    for (const d of depots) {
      const budget = Math.floor(d.MechanicHours);
      const res = knapsack(allTasks, budget);

      console.log(`\nDepot ID: ${d.ID}`);
      console.log(`Budget: ${budget}h | Used: ${res.time}h | Impact: ${res.impact}`);
      console.log(`Selected Tasks: ${res.selected.slice(0, 3).join(", ")}... (+${res.selected.length - 3} more)`);
    }

    await Logger.info("backend", "service", "Scheduling complete");
  } catch (err) {
    await Logger.error("backend", "service", "Scheduler error occurred");
    console.error(err);
  }
}

main();