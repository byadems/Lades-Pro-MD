"""
Lades-Pro Dashboard API Testing Suite
Consolidated tests for: Status, Groups, Commands, Config, Plugins, AI Generation
"""
import pytest
import requests
import os
import json

# Standard development URL for the Node.js dashboard server
BASE_URL = os.environ.get("DASHBOARD_URL", "http://localhost:3001")

class TestStatusEndpoint:
    """Bot status and health metrics"""
    
    def test_status_endpoint(self):
        """Test /api/status returns required structure"""
        response = requests.get(f"{BASE_URL}/api/status", timeout=10)
        assert response.status_code == 200
        data = response.json()
        
        required_fields = ["bot", "botName", "hasSession", "connected", "uptime", "memory", "nodeVersion"]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"
            
        print(f"✅ Status check passed for: {data.get('botName')}")

    def test_health_check(self):
        """Test simple /health endpoint"""
        response = requests.get(f"{BASE_URL}/health", timeout=10)
        assert response.status_code == 200
        assert response.json().get("status") == "ok"
        print("✅ Health check (ok)")


class TestGroupsEndpoint:
    """WhatsApp group management tests"""
    
    def test_groups_list(self):
        """Test /api/groups returns success and a list"""
        response = requests.get(f"{BASE_URL}/api/groups", timeout=15)
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("success") == True
        assert isinstance(data.get("groups"), list)
        print(f"✅ Found {len(data.get('groups'))} groups")


class TestCommandsEndpoint:
    """Command registry and categorization tests"""
    
    def test_categorized_commands(self):
        """Test /api/commands/categorized returned valid categories"""
        response = requests.get(f"{BASE_URL}/api/commands/categorized", timeout=10)
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("success") == True
        categories = data.get("categories", {})
        assert len(categories) > 0
        
        # Check core categories
        for core in ["genel", "system", "owner"]:
            assert core in categories, f"Core category '{core}' missing"
            
        print(f"✅ Command categorization check passed ({len(categories)} categories)")


class TestConfigEndpoint:
    """Environment configuration settings"""
    
    def test_config_settings(self):
        """Test that /api/config returns active settings"""
        response = requests.get(f"{BASE_URL}/api/config", timeout=10)
        assert response.status_code == 200
        data = response.json()
        
        # Verify branding was correctly updated
        assert data.get("BOT_NAME") == "Lades-Pro"
        assert "PREFIX" in data
        print(f"✅ Config check passed: Bot Name is {data.get('BOT_NAME')}")


class TestAIGeneration:
    """AI Command Factory (Gemini 3 Flash) integration tests"""
    
    def test_generate_command(self):
        """Test AI code generation with a simple prompt"""
        payload = {"description": "Selam veren basit bir komut"}
        response = requests.post(f"{BASE_URL}/api/ai/generate-command", json=payload, timeout=45)
        
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
        assert "code" in data
        assert len(data.get("code")) > 0
        print(f"✅ AI Generation check passed ({len(data.get('code'))} characters)")

    def test_save_command_validation(self):
        """Test that saving a command requires valid data"""
        # Test missing fields
        response = requests.post(f"{BASE_URL}/api/ai/save-command", json={"code": "test"}, timeout=10)
        assert response.status_code in [400, 422] # Pydantic validation error
        print("✅ Command save validation passed")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
