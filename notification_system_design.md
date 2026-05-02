# Stage 1: API Design & Real-Time Strategy

### Core Actions Supported
1. Fetch a paginated list of all notifications for the authenticated user.
2. Mark a specific notification as read.
3. Mark all notifications as read simultaneously.
4. Establish a real-time connection stream for live incoming updates.

### REST API Design

**1. Fetch Notifications**
* **Endpoint:** `GET /api/v1/notifications`
* **Headers:** `Authorization: Bearer <token>`
* **Query Params:** `?page=1&limit=20&filter=unread`
* **Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-string",
      "type": "Placement",
      "message": "CSX Corporation hiring",
      "isRead": false,
      "createdAt": "2026-04-22T17:51:18Z"
    }
  ],
  "meta": {
    "total": 15,
    "page": 1,
    "limit": 20
  }
}

```

# Stage 2: Database Storage & Schema Design

### Database Choice: PostgreSQL (Relational)
A relational database like PostgreSQL is the ideal choice for this notification system. Notifications are highly structured, require strict relationships (Notifications belong to Users), and necessitate complex filtering and sorting (e.g.,fetching by type, date, or read status), which SQL handles efficiently via indexing.

### Database Schema
**Table: `users`**
* `id` (UUID, Primary Key)
* `email` (VARCHAR, Unique)
* `name` (VARCHAR)

**Table: `notifications`**
* `id` (UUID, Primary Key)
* `user_id` (UUID, Foreign Key to `users.id`, Indexed)
* `type` (ENUM: 'Event', 'Result', 'Placement')
* `message` (TEXT)
* `is_read` (BOOLEAN, Default: false, Indexed)
* `created_at` (TIMESTAMP, Default: CURRENT_TIMESTAMP, Indexed)

### Scaling Challenges & Solutions
As data volume increases to millions of rows, database read/write latency will inevitably degrade. 

1. **Index Bloat:** Adding too many indexes to speed up read queries will inversely slow down write speeds (inserts/updates). 
   * *Solution:* Use highly tailored composite indexes rather than indexing every single column.
2. **Massive Table Size:** Querying a massive, monolithic table becomes slow even with proper indexes. 
   * *Solution:* Implement **Table Partitioning**. We can partition the `notifications` table by date (e.g., creating a new partition every month). Older partitions can be queried less frequently or moved to cold storage, keeping the active dataset small and highly performant.

---

# Stage 3: Query Optimization & Indexing Strategy

### Query Analysis
**Original Query:**
`SELECT * FROM notifications WHERE studentID = 1042 AND isRead = false ORDER BY createdAt DESC;`

* **Is it accurate?** Yes, the logic is technically correct for fetching unread notifications for a specific student.
* **Why is it slow?** Without proper indexing, the database must perform a **Full Table Scan** across all 5,000,000 rows to find matches. Furthermore, sorting the results via `ORDER BY createdAt DESC` requires an expensive in-memory sort (filesort) because the data is not pre-sorted on disk.
* **Proposed Changes & Cost:** We need to add a **Composite Index** specifically on `(studentID, isRead, createdAt DESC)`. This allows the database engine to instantly locate the exact student's unread notifications and retrieve them already in the correct sorted order without an extra sorting step. The computational cost drops drastically from $O(N)$ (where N is total rows) to $O(\log N + K)$ (where K is the number of unread notifications for that student).

### Evaluating the "Index Everything" Advice
Adding indexes on every column is **highly ineffective and dangerous advice**. 
* **Why not?** Every time a new notification is inserted (or updated), the database must not only write the row data but also recalculate and update *every single index*. In a write-heavy system like notifications, indexing every column will severely degrade write performance and consume a massive amount of unnecessary disk space (Index Bloat). Indexes should be strictly tailored to actual query access patterns.

### Placement Notifications Query
To find all distinct students who received a placement notification in the last 7 days:
```sql
SELECT DISTINCT studentID 
FROM notifications 
WHERE type = 'Placement' 
  AND created_at >= NOW() - INTERVAL '7 days';

```

# Stage 4: Performance & Database Load Mitigation

### The Problem
Fetching notifications from a relational database on every single page load for 50,000+ students creates an unsustainable read-heavy workload, leading to DB connection exhaustion and high latency.

### Proposed Solutions & Tradeoffs

**1. Implement a Caching Layer (Redis)**
Instead of querying the PostgreSQL database for the `unread_count` and recent notifications on every page load, we store this data in an in-memory datastore like Redis.
* **How it improves performance:** Redis operates in RAM, returning data in sub-milliseconds and completely bypassing the main database. When a new notification is generated, we push it to both the DB and the Redis cache. When a user reads it, we update both.
* **Tradeoffs:** Introduces architectural complexity. Cache invalidation is notoriously difficult; if the DB and Redis fall out of sync, users might see "ghost" notifications (cache staleness). It also increases infrastructure costs.

**2. Shift from "Pull" to "Push" (SSE / WebSockets)**
Relying on page loads is a "Pull" mechanism. We should utilize the Server-Sent Events (SSE) stream designed in Stage 1. 
* **How it improves performance:** The frontend connects to the SSE stream once. The initial state is loaded, and subsequent updates are pushed dynamically by the server. The client stores the data in local state (e.g., React Context / Redux). Navigating between pages in a Single Page Application (SPA) will no longer trigger backend fetch requests.
* **Tradeoffs:** Maintaining thousands of persistent, concurrent TCP connections requires robust server memory management and load balancers configured for long-lived connections.

**3. Client-Side Caching (Local Storage / IndexedDB)**
The frontend can cache the fetched notifications locally. On a new page load, the frontend immediately renders the local cache and only requests a "delta" (e.g., `GET /notifications?since=last_sync_timestamp`) in the background.
* **How it improves performance:** Drastically reduces the payload size and DB query complexity, as the DB only searches for records created in the last few minutes/hours rather than all unread items.
* **Tradeoffs:** Local storage has strict size limits (usually ~5MB). If the user clears their browser data or switches devices, the cache is lost and a full heavy fetch is required.
