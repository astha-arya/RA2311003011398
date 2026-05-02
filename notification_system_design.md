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


