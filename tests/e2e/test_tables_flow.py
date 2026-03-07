"""E2E tests for tables functionality."""
import pytest
from playwright.async_api import Page, expect


@pytest.fixture
async def authenticated_page(page: Page, base_url: str):
    """Login and return authenticated page."""
    await page.goto(f"{base_url}/login")
    await page.fill('input[name="email"]', "test@example.com")
    await page.fill('input[name="password"]', "Test123!@#")
    await page.click('button[type="submit"]')
    await page.wait_for_url(f"{base_url}/dashboard")
    return page


@pytest.mark.asyncio
async def test_create_table(authenticated_page: Page, base_url: str):
    """Test creating a new table."""
    page = authenticated_page
    
    # Navigate to tables
    await page.goto(f"{base_url}/tables")
    
    # Click create table button
    await page.click('button:has-text("New Table")')
    
    # Fill table form
    await page.fill('input[name="name"]', "Test Table")
    await page.fill('textarea[name="description"]', "This is a test table")
    
    # Submit
    await page.click('button:has-text("Create")')
    
    # Verify table created
    await expect(page.locator('text=Test Table')).to_be_visible(timeout=3000)


@pytest.mark.asyncio
async def test_add_column_to_table(authenticated_page: Page, base_url: str):
    """Test adding a column to table."""
    page = authenticated_page
    
    await page.goto(f"{base_url}/tables")
    
    # Open table
    await page.click('text=Test Table')
    
    # Add column
    await page.click('button:has-text("Add Column")')
    await page.fill('input[name="columnName"]', "Email")
    await page.select_option('select[name="columnType"]', "email")
    await page.click('button:has-text("Save")')
    
    # Verify column added
    await expect(page.locator('th:has-text("Email")')).to_be_visible()


@pytest.mark.asyncio
async def test_add_record_to_table(authenticated_page: Page, base_url: str):
    """Test adding a record to table."""
    page = authenticated_page
    
    await page.goto(f"{base_url}/tables")
    await page.click('text=Test Table')
    
    # Add record
    await page.click('button:has-text("Add Record")')
    await page.fill('input[name="Email"]', "user@example.com")
    await page.click('button:has-text("Save")')
    
    # Verify record added
    await expect(page.locator('td:has-text("user@example.com")')).to_be_visible()


@pytest.mark.asyncio
async def test_delete_table(authenticated_page: Page, base_url: str):
    """Test deleting a table."""
    page = authenticated_page
    
    await page.goto(f"{base_url}/tables")
    
    # Click table menu
    await page.click('button[aria-label="Table menu"]')
    await page.click('text=Delete')
    
    # Confirm deletion
    await page.click('button:has-text("Confirm")')
    
    # Verify table deleted
    await expect(page.locator('text=Test Table')).not_to_be_visible(timeout=3000)
