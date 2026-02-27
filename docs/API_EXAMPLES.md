# 📚 CRM Platform API Examples

Практические примеры использования API с curl, Python, и JavaScript.

---

## 🔐 Authentication

### Register New User

**cURL:**
```bash
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "first_name": "John",
    "last_name": "Doe"
  }'
```

**Python:**
```python
import requests

response = requests.post(
    "http://localhost:8000/api/v1/auth/register",
    json={
        "email": "user@example.com",
        "password": "SecurePass123!",
        "first_name": "John",
        "last_name": "Doe"
    }
)
data = response.json()
access_token = data["access_token"]
```

**JavaScript:**
```javascript
const response = await fetch('http://localhost:8000/api/v1/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'SecurePass123!',
    first_name: 'John',
    last_name: 'Doe'
  })
});
const data = await response.json();
const accessToken = data.access_token;
```

### Login

**cURL:**
```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'
```

---

## 🧱 Tables

### Create Table

**cURL:**
```bash
curl -X POST http://localhost:8000/api/v1/tables/ \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Customers",
    "description": "Customer database",
    "icon": "users",
    "color": "#3B82F6"
  }'
```

**Python:**
```python
headers = {"Authorization": f"Bearer {access_token}"}
response = requests.post(
    "http://localhost:8000/api/v1/tables/",
    headers=headers,
    json={
        "name": "Customers",
        "description": "Customer database",
        "icon": "users",
        "color": "#3B82F6"
    }
)
table = response.json()
table_id = table["id"]
```

### Add Column to Table

**cURL:**
```bash
curl -X POST http://localhost:8000/api/v1/tables/TABLE_ID/columns \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Email",
    "field_type": "email",
    "is_required": true,
    "position": 0
  }'
```

### Add Record

**cURL:**
```bash
curl -X POST http://localhost:8000/api/v1/tables/TABLE_ID/records/ \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "Email": "customer@example.com",
      "Name": "Jane Smith",
      "Phone": "+1234567890"
    }
  }'
```

### List Records with Pagination

**Python:**
```python
response = requests.get(
    f"http://localhost:8000/api/v1/tables/{table_id}/records/",
    headers=headers,
    params={"skip": 0, "limit": 100}
)
records = response.json()
```

### Export Table to CSV

**cURL:**
```bash
curl -X GET http://localhost:8000/api/v1/tables/TABLE_ID/export/csv \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -o customers.csv
```

---

## 🤖 AI Chat

### Send Chat Message

**cURL:**
```bash
curl -X POST http://localhost:8000/api/v1/ai/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Summarize my customer data",
    "context_sources": ["tables", "knowledge"],
    "chat_id": null
  }'
```

**Python:**
```python
response = requests.post(
    "http://localhost:8000/api/v1/ai/chat",
    headers=headers,
    json={
        "message": "Summarize my customer data",
        "context_sources": ["tables", "knowledge"],
        "chat_id": None
    }
)
ai_response = response.json()
```

### Get Chat History

**cURL:**
```bash
curl -X GET http://localhost:8000/api/v1/ai/chats/CHAT_ID/messages \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 📊 Reports & Analytics

### Get Summary Report

**cURL:**
```bash
curl -X GET http://localhost:8000/api/v1/reports/summary \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Python:**
```python
response = requests.get(
    "http://localhost:8000/api/v1/reports/summary",
    headers=headers
)
summary = response.json()
print(f"Total tables: {summary['total_tables']}")
print(f"Total records: {summary['total_records']}")
```

### Create Dashboard

**cURL:**
```bash
curl -X POST http://localhost:8000/api/v1/reports/dashboards \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sales Dashboard",
    "description": "Track sales metrics",
    "layout": "grid"
  }'
```

---

## 🏢 Organizations

### Get Current Organization

**cURL:**
```bash
curl -X GET http://localhost:8000/api/v1/orgs/current \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Invite User

**cURL:**
```bash
curl -X POST http://localhost:8000/api/v1/orgs/invites \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "role": "employee"
  }'
```

---

## 📅 Schedule

### Create Event

**cURL:**
```bash
curl -X POST http://localhost:8000/api/v1/schedule/events \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Team Meeting",
    "description": "Weekly sync",
    "start_time": "2026-03-01T10:00:00Z",
    "end_time": "2026-03-01T11:00:00Z",
    "all_day": false
  }'
```

---

## 🔍 Advanced Examples

### Batch Create Records

**Python:**
```python
records = [
    {"data": {"Email": f"user{i}@example.com", "Name": f"User {i}"}}
    for i in range(100)
]

for record in records:
    requests.post(
        f"http://localhost:8000/api/v1/tables/{table_id}/records/",
        headers=headers,
        json=record
    )
```

### Search with Filters

**cURL:**
```bash
curl -X GET "http://localhost:8000/api/v1/tables/TABLE_ID/records/?filter=Email:contains:@example.com" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Webhook Integration

**Python:**
```python
# Setup webhook to receive table updates
webhook_url = "https://your-server.com/webhook"

# When record is created, API sends POST to webhook_url
# Example webhook handler:
from flask import Flask, request

app = Flask(__name__)

@app.route('/webhook', methods=['POST'])
def handle_webhook():
    data = request.json
    print(f"New record: {data}")
    return {"status": "ok"}
```

---

## 🚀 Performance Tips

### Use Pagination
```python
# Good: Paginate large datasets
response = requests.get(
    f"http://localhost:8000/api/v1/tables/{table_id}/records/",
    params={"skip": 0, "limit": 100}
)

# Bad: Loading all records at once
# response = requests.get(f"http://localhost:8000/api/v1/tables/{table_id}/records/")
```

### Cache Responses
```python
import requests_cache

# Enable caching for 5 minutes
requests_cache.install_cache('crm_cache', expire_after=300)

response = requests.get(
    "http://localhost:8000/api/v1/orgs/current",
    headers=headers
)
```

### Batch Operations
```python
# Use bulk endpoints when available
# Instead of creating records one by one, use batch import
with open('customers.csv', 'rb') as f:
    requests.post(
        f"http://localhost:8000/api/v1/tables/{table_id}/import/csv",
        headers=headers,
        files={'file': f}
    )
```

---

## 🔒 Security Best Practices

### Store Tokens Securely
```python
import os
from dotenv import load_dotenv

load_dotenv()
access_token = os.getenv('CRM_ACCESS_TOKEN')
```

### Refresh Tokens
```python
def refresh_access_token(refresh_token):
    response = requests.post(
        "http://localhost:8000/api/v1/auth/refresh",
        json={"refresh_token": refresh_token}
    )
    return response.json()["access_token"]
```

### Rate Limiting
```python
import time

def api_call_with_retry(url, **kwargs):
    max_retries = 3
    for i in range(max_retries):
        response = requests.get(url, **kwargs)
        if response.status_code == 429:  # Rate limited
            time.sleep(2 ** i)  # Exponential backoff
            continue
        return response
    raise Exception("Max retries exceeded")
```

---

## 📖 Additional Resources

- **OpenAPI Spec:** http://localhost:8000/api/openapi.json
- **Swagger UI:** http://localhost:8000/api/docs
- **Health Check:** http://localhost:8000/api/health
- **Metrics:** http://localhost:8000/metrics

---

**Last Updated:** 27 февраля 2026
