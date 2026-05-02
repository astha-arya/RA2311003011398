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