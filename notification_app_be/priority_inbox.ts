import { Logger } from "../logging_middleware/dist/index.js";

// ---------------------------------------------------------------------------
// Types - Matched to API's Uppercase Keys
// ---------------------------------------------------------------------------

type NotificationType = "Placement" | "Result" | "Event";

interface APIResponse {
  notifications: Notification[];
}

interface Notification {
  ID: string;
  Type: NotificationType;
  Message: string;
  Timestamp: string;
  isRead?: boolean; // The API doesn't specify a 'read' field, we assume unread unless specified
}

interface RankedNotification extends Notification {
  weight: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENDPOINT = "http://20.207.122.201/evaluation-service/notifications";

const TYPE_WEIGHT: Record<NotificationType, number> = {
  Placement: 3,
  Result: 2,
  Event: 1,
};

const TOP_N = 10;

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function getBearerToken(): string {
  const token = process.env.BEARER_TOKEN;
  if (!token?.trim()) {
    throw new Error("BEARER_TOKEN environment variable is not set.");
  }
  return token.trim();
}

async function fetchNotifications(token: string): Promise<Notification[]> {
  const response = await fetch(ENDPOINT, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`API responded with HTTP ${response.status} (${response.statusText})`);
  }

  const data = await response.json() as APIResponse;
  
  // CRITICAL FIX: The API returns { "notifications": [...] }, so we return data.notifications
  return data.notifications || [];
}

function rankNotifications(notifications: Notification[]): RankedNotification[] {
  return notifications
    .map((n): RankedNotification => ({
      ...n,
      weight: TYPE_WEIGHT[n.Type] ?? 0,
    }))
    .sort((a, b) => {
      // Sort by weight first (Descending)
      if (b.weight !== a.weight) return b.weight - a.weight;
      // Then sort by timestamp (Descending)
      return new Date(b.Timestamp).getTime() - new Date(a.Timestamp).getTime();
    })
    .slice(0, TOP_N);
}

function printTable(notifications: RankedNotification[]): void {
  const col = { rank: 6, id: 38, type: 12, weight: 8, time: 22, message: 40 };

  const pad = (s: string, n: number) => (s || "").slice(0, n).padEnd(n);
  const divider = Object.values(col).map((w) => "─".repeat(w)).join("─┼─");
  const header = [
    pad("Rank", col.rank),
    pad("ID", col.id),
    pad("Type", col.type),
    pad("Weight", col.weight),
    pad("Timestamp", col.time),
    pad("Message", col.message),
  ].join(" │ ");

  console.log("\n  ┌─" + divider + "─┐");
  console.log(`  │ ${header} │`);
  console.log("  ├─" + divider + "─┤");

  notifications.forEach((n, i) => {
    const row = [
      pad(String(i + 1), col.rank),
      pad(n.ID, col.id),
      pad(n.Type, col.type),
      pad(String(n.weight), col.weight),
      pad(n.Timestamp, col.time),
      pad(n.Message, col.message),
    ].join(" │ ");
    console.log(`  │ ${row} │`);
  });

  console.log("  └─" + divider + "─┘\n");
}

async function main() {
  try {
    const token = getBearerToken();
    Logger.init({ bearerToken: token });

    await Logger.info("backend", "service", "Priority inbox: fetching data");

    const notifications = await fetchNotifications(token);
    const top = rankNotifications(notifications);

    await Logger.info("backend", "service", `Ranked top ${top.length} notifications`);
    
    printTable(top);
  } catch (err) {
    console.error(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

main();