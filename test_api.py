# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r'e:\AI_Agent\backend')

import httpx

def test_backend():
    base_url = "http://localhost:8000/api/v1"
    
    # Test login
    print("=== Testing Login ===")
    login_data = {
        "email": "admin@deepreader.com",
        "password": "admin123"
    }
    
    client = httpx.Client()
    response = client.post(f"{base_url}/auth/login", json=login_data)
    print(f"Login status: {response.status_code}")
    print(f"Login response: {response.text[:200]}")
    
    if response.status_code == 200:
        data = response.json()
        access_token = data.get('access_token')
        print(f"\nAccess token: {access_token[:50]}...")
        
        # Test batches with token
        print("\n=== Testing Batches with Token ===")
        print(f"Sending request with Authorization header: Bearer {access_token[:50]}...")
        batches_response = client.get(
            f"{base_url}/batches?page=1&page_size=10",
            headers={'Authorization': f'Bearer {access_token}'}
        )
        print(f"Batches status: {batches_response.status_code}")
        print(f"Batches response: {batches_response.text[:500]}")

if __name__ == "__main__":
    test_backend()
