"""Locust performance tests for CRM API."""
from locust import HttpUser, task, between, events
import random
import json


class CRMUser(HttpUser):
    """Simulated CRM user."""
    
    wait_time = between(1, 3)
    host = "http://localhost:8000"
    
    def on_start(self):
        """Login before starting tasks."""
        # Register or login
        response = self.client.post("/api/v1/auth/login", json={
            "email": f"loadtest{random.randint(1, 1000)}@example.com",
            "password": "Test123!@#"
        }, catch_response=True)
        
        if response.status_code == 200:
            data = response.json()
            self.token = data.get("access_token")
        else:
            # Try to register
            response = self.client.post("/api/v1/auth/register", json={
                "email": f"loadtest{random.randint(1, 10000)}@example.com",
                "password": "Test123!@#",
                "first_name": "Load",
                "last_name": "Test"
            })
            if response.status_code == 200:
                data = response.json()
                self.token = data.get("access_token")
    
    def _headers(self):
        """Get auth headers."""
        return {"Authorization": f"Bearer {self.token}"}
    
    @task(5)
    def list_tables(self):
        """List tables (read-heavy operation)."""
        self.client.get(
            "/api/v1/tables/",
            headers=self._headers(),
            name="GET /api/v1/tables/"
        )
    
    @task(3)
    def get_current_org(self):
        """Get current organization."""
        self.client.get(
            "/api/v1/orgs/current",
            headers=self._headers(),
            name="GET /api/v1/orgs/current"
        )
    
    @task(2)
    def list_knowledge_pages(self):
        """List knowledge base pages."""
        self.client.get(
            "/api/v1/knowledge/pages",
            headers=self._headers(),
            name="GET /api/v1/knowledge/pages"
        )
    
    @task(1)
    def create_table(self):
        """Create a new table (write operation)."""
        self.client.post(
            "/api/v1/tables/",
            json={
                "name": f"Load Test Table {random.randint(1, 10000)}",
                "description": "Created by load test"
            },
            headers=self._headers(),
            name="POST /api/v1/tables/"
        )
    
    @task(1)
    def get_reports_summary(self):
        """Get reports summary."""
        self.client.get(
            "/api/v1/reports/summary",
            headers=self._headers(),
            name="GET /api/v1/reports/summary"
        )
    
    @task(1)
    def health_check(self):
        """Health check endpoint."""
        self.client.get("/api/health", name="GET /api/health")


class AdminUser(HttpUser):
    """Simulated admin user with heavier operations."""
    
    wait_time = between(2, 5)
    host = "http://localhost:8000"
    weight = 1  # Less admin users
    
    def on_start(self):
        """Login as admin."""
        response = self.client.post("/api/v1/auth/login", json={
            "email": "admin@example.com",
            "password": "Admin123!@#"
        })
        if response.status_code == 200:
            data = response.json()
            self.token = data.get("access_token")
    
    def _headers(self):
        return {"Authorization": f"Bearer {self.token}"}
    
    @task(3)
    def list_org_members(self):
        """List organization members."""
        self.client.get(
            "/api/v1/orgs/members",
            headers=self._headers(),
            name="GET /api/v1/orgs/members"
        )
    
    @task(2)
    def get_audit_logs(self):
        """Get audit logs."""
        self.client.get(
            "/api/v1/audit/logs",
            headers=self._headers(),
            name="GET /api/v1/audit/logs"
        )
    
    @task(1)
    def export_table_csv(self):
        """Export table to CSV."""
        # Assuming we have a table_id
        self.client.get(
            "/api/v1/tables/1/export/csv",
            headers=self._headers(),
            name="GET /api/v1/tables/{id}/export/csv"
        )


@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    """Called when test starts."""
    print("Load test starting...")


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Called when test stops."""
    print("Load test completed!")
    print(f"Total requests: {environment.stats.total.num_requests}")
    print(f"Total failures: {environment.stats.total.num_failures}")
    print(f"Average response time: {environment.stats.total.avg_response_time:.2f}ms")
    print(f"RPS: {environment.stats.total.total_rps:.2f}")
