"""
Lades-Pro-MD Dashboard API Tests - Iteration 2
Tests for: AI Command Generation (Gemini 3 Flash), Groups, Commands, Config, Plugins
"""
import pytest
import requests
import os
import json

# Use preview URL for testing
BASE_URL = "https://ebd1d2c7-da6f-49af-bc6a-f7a6b4db085f.preview.emergentagent.com"


class TestStatusEndpoint:
    """Bot status endpoint tests"""
    
    def test_status_returns_200(self):
        """Test /api/status returns 200"""
        response = requests.get(f"{BASE_URL}/api/status", timeout=10)
        assert response.status_code == 200
        print(f"✅ /api/status returned 200")
    
    def test_status_has_required_fields(self):
        """Test /api/status has all required fields"""
        response = requests.get(f"{BASE_URL}/api/status", timeout=10)
        data = response.json()
        
        required_fields = ["bot", "botName", "hasSession", "connected", "phone", "uptime", "memory", "nodeVersion"]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"
        print(f"✅ /api/status has all required fields")
    
    def test_status_bot_connected(self):
        """Test bot is connected"""
        response = requests.get(f"{BASE_URL}/api/status", timeout=10)
        data = response.json()
        
        assert data.get("connected") == True, "Bot should be connected"
        assert data.get("phone") is not None, "Phone should be set"
        print(f"✅ Bot connected with phone: {data.get('phone')}")
    
    def test_status_runtime_stats(self):
        """Test runtime stats are present"""
        response = requests.get(f"{BASE_URL}/api/status", timeout=10)
        data = response.json()
        
        assert "totalMessages" in data
        assert "totalCommands" in data
        assert "activeUsers" in data
        assert "managedGroups" in data
        print(f"✅ Runtime stats: {data.get('totalMessages')} messages, {data.get('totalCommands')} commands")


class TestGroupsEndpoint:
    """Groups endpoint tests - should return 7 groups"""
    
    def test_groups_returns_200(self):
        """Test /api/groups returns 200"""
        response = requests.get(f"{BASE_URL}/api/groups", timeout=15)
        assert response.status_code == 200
        print(f"✅ /api/groups returned 200")
    
    def test_groups_returns_7_groups(self):
        """Test /api/groups returns exactly 7 groups"""
        response = requests.get(f"{BASE_URL}/api/groups", timeout=15)
        data = response.json()
        
        assert data.get("success") == True
        groups = data.get("groups", [])
        assert len(groups) == 7, f"Expected 7 groups, got {len(groups)}"
        print(f"✅ /api/groups returned {len(groups)} groups")
    
    def test_groups_have_required_fields(self):
        """Test each group has required fields"""
        response = requests.get(f"{BASE_URL}/api/groups", timeout=15)
        data = response.json()
        groups = data.get("groups", [])
        
        for group in groups:
            assert "jid" in group, "Group missing jid"
            assert "subject" in group, "Group missing subject"
            assert "@g.us" in group["jid"], "JID should be a group JID"
        print(f"✅ All groups have required fields (jid, subject)")


class TestCommandsCategorizedEndpoint:
    """Categorized commands endpoint tests - should return 23 categories"""
    
    def test_commands_categorized_returns_200(self):
        """Test /api/commands/categorized returns 200"""
        response = requests.get(f"{BASE_URL}/api/commands/categorized", timeout=10)
        assert response.status_code == 200
        print(f"✅ /api/commands/categorized returned 200")
    
    def test_commands_categorized_returns_23_categories(self):
        """Test /api/commands/categorized returns 23 categories"""
        response = requests.get(f"{BASE_URL}/api/commands/categorized", timeout=10)
        data = response.json()
        
        assert data.get("success") == True
        categories = data.get("categories", {})
        assert len(categories) == 23, f"Expected 23 categories, got {len(categories)}"
        print(f"✅ /api/commands/categorized returned {len(categories)} categories")
    
    def test_commands_categorized_has_expected_categories(self):
        """Test expected categories are present"""
        response = requests.get(f"{BASE_URL}/api/commands/categorized", timeout=10)
        data = response.json()
        categories = data.get("categories", {})
        
        expected = ["genel", "owner", "ai", "tools", "group", "system"]
        for cat in expected:
            assert cat in categories, f"Missing category: {cat}"
        print(f"✅ All expected categories present")


class TestAIGenerateCommandEndpoint:
    """AI Command Generation endpoint tests - Gemini 3 Flash"""
    
    def test_ai_generate_returns_200(self):
        """Test /api/ai/generate-command returns 200"""
        response = requests.post(
            f"{BASE_URL}/api/ai/generate-command",
            json={"description": "test komutu"},
            timeout=30
        )
        assert response.status_code == 200
        print(f"✅ /api/ai/generate-command returned 200")
    
    def test_ai_generate_returns_code(self):
        """Test AI generates valid code"""
        response = requests.post(
            f"{BASE_URL}/api/ai/generate-command",
            json={"description": "Kullanıcıya merhaba diyen basit bir komut"},
            timeout=30
        )
        data = response.json()
        
        assert data.get("success") == True, f"AI generation failed: {data.get('error')}"
        assert "code" in data, "Response missing code field"
        assert len(data["code"]) > 50, "Generated code too short"
        print(f"✅ AI generated code ({len(data['code'])} chars)")
    
    def test_ai_generate_uses_gemini_3_flash(self):
        """Test AI uses Gemini 3 Flash model"""
        response = requests.post(
            f"{BASE_URL}/api/ai/generate-command",
            json={"description": "test"},
            timeout=30
        )
        data = response.json()
        
        assert data.get("model") == "gemini-3-flash", f"Expected gemini-3-flash, got {data.get('model')}"
        print(f"✅ AI uses model: {data.get('model')}")
    
    def test_ai_generate_code_has_module_structure(self):
        """Test generated code has proper Module structure"""
        response = requests.post(
            f"{BASE_URL}/api/ai/generate-command",
            json={"description": "Kullanıcıya selam veren komut"},
            timeout=30
        )
        data = response.json()
        code = data.get("code", "")
        
        assert "Module" in code or "module" in code.lower(), "Code should contain Module"
        assert "pattern" in code, "Code should contain pattern"
        print(f"✅ Generated code has proper Module structure")
    
    def test_ai_generate_empty_description_error(self):
        """Test empty description returns error"""
        response = requests.post(
            f"{BASE_URL}/api/ai/generate-command",
            json={"description": ""},
            timeout=10
        )
        data = response.json()
        
        assert "error" in data, "Should return error for empty description"
        print(f"✅ Empty description returns error: {data.get('error')}")


class TestAISaveCommandEndpoint:
    """AI Save Command endpoint tests"""
    
    def test_ai_save_returns_200(self):
        """Test /api/ai/save-command returns 200"""
        response = requests.post(
            f"{BASE_URL}/api/ai/save-command",
            json={
                "code": 'const { Module } = require("../main");\nModule({ pattern: "pytest", fromMe: false, desc: "Test" }, async (m) => { await m.sendReply("Test!"); });',
                "name": "pytest-test"
            },
            timeout=10
        )
        assert response.status_code == 200
        print(f"✅ /api/ai/save-command returned 200")
    
    def test_ai_save_creates_file(self):
        """Test AI save creates file with correct name"""
        response = requests.post(
            f"{BASE_URL}/api/ai/save-command",
            json={
                "code": 'const { Module } = require("../main");\nModule({ pattern: "savetest", fromMe: false, desc: "Save Test" }, async (m) => { await m.sendReply("Saved!"); });',
                "name": "save-test-cmd"
            },
            timeout=10
        )
        data = response.json()
        
        assert data.get("success") == True
        assert "fileName" in data
        assert data["fileName"] == "ai-save-test-cmd.js"
        print(f"✅ AI save created file: {data.get('fileName')}")
    
    def test_ai_save_missing_fields_error(self):
        """Test missing fields returns error"""
        response = requests.post(
            f"{BASE_URL}/api/ai/save-command",
            json={"code": "test"},
            timeout=10
        )
        data = response.json()
        
        # Pydantic returns 'detail' for validation errors
        assert "error" in data or "detail" in data, "Should return error for missing name"
        print(f"✅ Missing fields returns validation error")


class TestConfigEndpoint:
    """Config endpoint tests"""
    
    def test_config_returns_200(self):
        """Test /api/config returns 200"""
        response = requests.get(f"{BASE_URL}/api/config", timeout=10)
        assert response.status_code == 200
        print(f"✅ /api/config returned 200")
    
    def test_config_has_required_fields(self):
        """Test config has required fields"""
        response = requests.get(f"{BASE_URL}/api/config", timeout=10)
        data = response.json()
        
        required = ["BOT_NAME", "PREFIX", "LANG", "PUBLIC_MODE", "AUTO_READ"]
        for field in required:
            assert field in data, f"Missing config field: {field}"
        print(f"✅ Config has all required fields")
    
    def test_config_bot_name(self):
        """Test bot name is set"""
        response = requests.get(f"{BASE_URL}/api/config", timeout=10)
        data = response.json()
        
        assert data.get("BOT_NAME") == "Lades-Pro"
        print(f"✅ Bot name: {data.get('BOT_NAME')}")


class TestPluginsEndpoint:
    """Plugins endpoint tests - should return 43+ plugins"""
    
    def test_plugins_returns_200(self):
        """Test /api/plugins returns 200"""
        response = requests.get(f"{BASE_URL}/api/plugins", timeout=10)
        assert response.status_code == 200
        print(f"✅ /api/plugins returned 200")
    
    def test_plugins_returns_list(self):
        """Test /api/plugins returns plugin list"""
        response = requests.get(f"{BASE_URL}/api/plugins", timeout=10)
        data = response.json()
        
        assert data.get("success") == True
        plugins = data.get("plugins", [])
        assert len(plugins) >= 40, f"Expected 40+ plugins, got {len(plugins)}"
        print(f"✅ /api/plugins returned {len(plugins)} plugins")
    
    def test_plugins_have_required_fields(self):
        """Test plugins have required fields"""
        response = requests.get(f"{BASE_URL}/api/plugins", timeout=10)
        data = response.json()
        plugins = data.get("plugins", [])
        
        for plugin in plugins[:5]:  # Check first 5
            assert "id" in plugin
            assert "name" in plugin
            assert "active" in plugin
        print(f"✅ Plugins have required fields")


class TestRuntimeStatsEndpoint:
    """Runtime stats endpoint tests"""
    
    def test_runtime_stats_returns_200(self):
        """Test /api/runtime-stats returns 200"""
        response = requests.get(f"{BASE_URL}/api/runtime-stats", timeout=10)
        assert response.status_code == 200
        print(f"✅ /api/runtime-stats returned 200")
    
    def test_runtime_stats_has_fields(self):
        """Test runtime stats has required fields"""
        response = requests.get(f"{BASE_URL}/api/runtime-stats", timeout=10)
        data = response.json()
        
        assert "totalMessages" in data
        assert "totalCommands" in data
        assert "activeUsers" in data
        assert "managedGroups" in data
        print(f"✅ Runtime stats: messages={data.get('totalMessages')}, commands={data.get('totalCommands')}")


class TestHealthEndpoint:
    """Health check endpoint tests"""
    
    def test_health_returns_200(self):
        """Test /health returns 200"""
        response = requests.get(f"{BASE_URL}/health", timeout=10)
        assert response.status_code == 200
        print(f"✅ /health returned 200")
    
    def test_health_status_ok(self):
        """Test health status is ok"""
        response = requests.get(f"{BASE_URL}/health", timeout=10)
        data = response.json()
        
        assert data.get("status") == "ok"
        print(f"✅ Health status: {data.get('status')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
