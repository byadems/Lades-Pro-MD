#!/usr/bin/env python3
"""
Lades-Pro-MD Backend API Testing
Tests the FastAPI proxy backend and Node.js dashboard APIs
"""

import requests
import sys
import json
from datetime import datetime

class LadesProAPITester:
    def __init__(self, base_url="https://6b0447e1-ae87-4faf-aa6b-f587c6b292ad.preview.emergentagent.com"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def run_test(self, name, method, endpoint, expected_status, data=None, timeout=10):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=timeout)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=timeout)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=timeout)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=timeout)

            success = response.status_code == expected_status
            
            result = {
                "test_name": name,
                "endpoint": endpoint,
                "method": method,
                "expected_status": expected_status,
                "actual_status": response.status_code,
                "success": success,
                "response_time": response.elapsed.total_seconds(),
                "timestamp": datetime.now().isoformat()
            }

            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                
                # Try to parse JSON response
                try:
                    json_data = response.json()
                    result["response_data"] = json_data
                    print(f"   Response: {json.dumps(json_data, indent=2)[:200]}...")
                except:
                    result["response_text"] = response.text[:200]
                    print(f"   Response: {response.text[:200]}...")
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                print(f"   Response: {response.text[:200]}...")
                result["error_response"] = response.text[:500]

            self.test_results.append(result)
            return success, response

        except requests.exceptions.Timeout:
            print(f"❌ Failed - Request timeout after {timeout}s")
            result = {
                "test_name": name,
                "endpoint": endpoint,
                "method": method,
                "expected_status": expected_status,
                "actual_status": "TIMEOUT",
                "success": False,
                "error": "Request timeout",
                "timestamp": datetime.now().isoformat()
            }
            self.test_results.append(result)
            return False, None
        except requests.exceptions.ConnectionError:
            print(f"❌ Failed - Connection error")
            result = {
                "test_name": name,
                "endpoint": endpoint,
                "method": method,
                "expected_status": expected_status,
                "actual_status": "CONNECTION_ERROR",
                "success": False,
                "error": "Connection error",
                "timestamp": datetime.now().isoformat()
            }
            self.test_results.append(result)
            return False, None
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            result = {
                "test_name": name,
                "endpoint": endpoint,
                "method": method,
                "expected_status": expected_status,
                "actual_status": "ERROR",
                "success": False,
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
            self.test_results.append(result)
            return False, None

    def test_health_check(self):
        """Test backend health check"""
        return self.run_test(
            "Backend Health Check",
            "GET",
            "api/health",
            200
        )

    def test_dashboard_info(self):
        """Test dashboard info endpoint"""
        return self.run_test(
            "Dashboard Info",
            "GET", 
            "api/dashboard/info",
            200
        )

    def test_status_api(self):
        """Test bot status API (proxied to Node.js)"""
        return self.run_test(
            "Bot Status API",
            "GET",
            "api/status",
            200,
            timeout=15
        )

    def test_commands_api(self):
        """Test commands list API (proxied to Node.js)"""
        return self.run_test(
            "Commands List API",
            "GET",
            "api/commands",
            200,
            timeout=15
        )

    def verify_owner_number(self, response_data):
        """Verify that +905396978235 is set as owner"""
        print(f"\n🔍 Verifying owner number configuration...")
        
        owner_found = False
        owner_sources = []
        
        # Check dashboard info response
        if isinstance(response_data, dict):
            if response_data.get('owner_number') == '905396978235':
                owner_found = True
                owner_sources.append("dashboard_info.owner_number")
                print(f"✅ Owner number found in dashboard info: {response_data.get('owner_number')}")
        
        return owner_found, owner_sources

    def print_summary(self):
        """Print test summary"""
        print(f"\n" + "="*60)
        print(f"📊 TEST SUMMARY")
        print(f"="*60)
        print(f"Tests Run: {self.tests_run}")
        print(f"Tests Passed: {self.tests_passed}")
        print(f"Tests Failed: {self.tests_run - self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%" if self.tests_run > 0 else "0%")
        
        if self.tests_passed < self.tests_run:
            print(f"\n❌ FAILED TESTS:")
            for result in self.test_results:
                if not result["success"]:
                    print(f"   - {result['test_name']}: {result.get('error', 'Status mismatch')}")
        
        return self.tests_passed == self.tests_run

def main():
    print("🚀 Starting Lades-Pro-MD Backend API Tests")
    print("="*60)
    
    tester = LadesProAPITester()
    
    # Test 1: Backend Health Check
    health_success, health_response = tester.test_health_check()
    
    # Test 2: Dashboard Info
    info_success, info_response = tester.test_dashboard_info()
    
    # Verify owner number in dashboard info
    if info_success and info_response:
        try:
            info_data = info_response.json()
            owner_found, sources = tester.verify_owner_number(info_data)
            if not owner_found:
                print(f"⚠️  Warning: Owner number +905396978235 not found in dashboard info")
        except:
            pass
    
    # Test 3: Bot Status API (may fail if Node.js dashboard not running)
    status_success, status_response = tester.test_status_api()
    
    # Test 4: Commands API (may fail if Node.js dashboard not running)
    commands_success, commands_response = tester.test_commands_api()
    
    # Print final summary
    all_passed = tester.print_summary()
    
    # Save test results
    with open('/app/test_reports/backend_test_results.json', 'w') as f:
        json.dump({
            "timestamp": datetime.now().isoformat(),
            "summary": {
                "tests_run": tester.tests_run,
                "tests_passed": tester.tests_passed,
                "success_rate": (tester.tests_passed/tester.tests_run*100) if tester.tests_run > 0 else 0
            },
            "test_results": tester.test_results
        }, f, indent=2)
    
    print(f"\n📄 Test results saved to: /app/test_reports/backend_test_results.json")
    
    return 0 if all_passed else 1

if __name__ == "__main__":
    sys.exit(main())