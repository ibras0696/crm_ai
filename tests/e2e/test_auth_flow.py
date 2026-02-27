"""E2E tests for authentication flow."""
import pytest
from playwright.async_api import Page, expect


@pytest.mark.asyncio
async def test_registration_flow(page: Page, base_url: str):
    """Test user registration flow."""
    await page.goto(f"{base_url}/register")
    
    # Fill registration form
    await page.fill('input[name="email"]', "test@example.com")
    await page.fill('input[name="password"]', "Test123!@#")
    await page.fill('input[name="firstName"]', "Test")
    await page.fill('input[name="lastName"]', "User")
    
    # Submit form
    await page.click('button[type="submit"]')
    
    # Wait for redirect to dashboard
    await page.wait_for_url(f"{base_url}/dashboard", timeout=5000)
    
    # Verify user is logged in
    await expect(page.locator('text=Test User')).to_be_visible()


@pytest.mark.asyncio
async def test_login_flow(page: Page, base_url: str):
    """Test user login flow."""
    await page.goto(f"{base_url}/login")
    
    # Fill login form
    await page.fill('input[name="email"]', "test@example.com")
    await page.fill('input[name="password"]', "Test123!@#")
    
    # Submit form
    await page.click('button[type="submit"]')
    
    # Wait for redirect
    await page.wait_for_url(f"{base_url}/dashboard", timeout=5000)
    
    # Verify dashboard loaded
    await expect(page.locator('h1')).to_contain_text("Dashboard")


@pytest.mark.asyncio
async def test_logout_flow(page: Page, base_url: str):
    """Test user logout flow."""
    # Login first
    await page.goto(f"{base_url}/login")
    await page.fill('input[name="email"]', "test@example.com")
    await page.fill('input[name="password"]', "Test123!@#")
    await page.click('button[type="submit"]')
    await page.wait_for_url(f"{base_url}/dashboard")
    
    # Logout
    await page.click('button[aria-label="User menu"]')
    await page.click('text=Logout')
    
    # Verify redirected to login
    await page.wait_for_url(f"{base_url}/login", timeout=5000)


@pytest.mark.asyncio
async def test_invalid_login(page: Page, base_url: str):
    """Test login with invalid credentials."""
    await page.goto(f"{base_url}/login")
    
    await page.fill('input[name="email"]', "wrong@example.com")
    await page.fill('input[name="password"]', "wrongpassword")
    await page.click('button[type="submit"]')
    
    # Verify error message
    await expect(page.locator('text=Invalid credentials')).to_be_visible(timeout=3000)
