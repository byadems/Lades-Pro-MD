"""
Backend API Tests for Lades-Pro-MD Dashboard
Tests all dashboard API endpoints through the Node.js dashboard server on port 3001
"""
import pytest
import requests

# Use direct Node.js dashboard URL since FastAPI proxy has connection issues
BASE_URL: str = "http://localhost:3001"


class TestStatusEndpoint:
    """Test /api/status endpoint - bot status"""

    def test_status_returns_200(self) -> None:
        """Test that status endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/status", timeout=10)
        assert response.status_code == 200
        print("✅ /api/status returned 200")

    def test_status_returns_required_fields(self) -> None:
        """Test that status response contains required fields"""
        response = requests.get(f"{BASE_URL}/api/status", timeout=10)
        data: dict = response.json()

        required_fields = ['bot', 'botName', 'hasSession', 'connected', 'uptime', 'memory', 'nodeVersion']
        for field in required_fields:
            assert field in data, f"Missing field: {field}"
            print(f"✅ Field '{field}' present: {data[field]}")

        assert isinstance(data['connected'], bool)
        assert isinstance(data['uptime'], (int, float))
        print("✅ Status data types are correct")


class TestCommandsEndpoint:
    """Test /api/commands endpoint - command list"""

    def test_commands_returns_200(self) -> None:
        """Test that commands endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/commands", timeout=10)
        assert response.status_code == 200
        print("✅ /api/commands returned 200")

    def test_commands_returns_list(self) -> None:
        """Test that commands response contains command list"""
        response = requests.get(f"{BASE_URL}/api/commands", timeout=10)
        data: dict = response.json()

        assert 'commands' in data
        assert 'total' in data
        assert isinstance(data['commands'], list)
        assert data['total'] > 0
        print(f"✅ Commands list contains {data['total']} commands")

    def test_command_structure(self) -> None:
        """Test that each command has required fields"""
        response = requests.get(f"{BASE_URL}/api/commands", timeout=10)
        data: dict = response.json()

        if data['commands']:
            cmd = data['commands'][0]
            assert 'pattern' in cmd
            print(f"✅ Command structure is valid, first command: .{cmd['pattern']}")


class TestCategorizedCommandsEndpoint:
    """Test /api/commands/categorized endpoint"""

    def test_categorized_returns_200(self) -> None:
        """Test that categorized commands endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/commands/categorized", timeout=10)
        assert response.status_code == 200
        print("✅ /api/commands/categorized returned 200")

    def test_categorized_returns_categories(self) -> None:
        """Test that response contains categories"""
        response = requests.get(f"{BASE_URL}/api/commands/categorized", timeout=10)
        data: dict = response.json()

        assert 'success' in data
        assert 'categories' in data
        assert isinstance(data['categories'], dict)

        category_count: int = len(data['categories'])
        print(f"✅ Found {category_count} command categories")

        for cat_name in list(data['categories'].keys())[:5]:
            print(f"   - {cat_name}: {len(data['categories'][cat_name])} commands")


class TestGroupsEndpoint:
    """Test /api/groups endpoint"""

    def test_groups_returns_200(self) -> None:
        """Test that groups endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/groups", timeout=10)
        assert response.status_code == 200
        print("✅ /api/groups returned 200")

    def test_groups_returns_list(self) -> None:
        """Test that groups response contains groups list"""
        response = requests.get(f"{BASE_URL}/api/groups", timeout=10)
        data: dict = response.json()

        assert 'success' in data
        assert 'groups' in data
        assert isinstance(data['groups'], list)
        print(f"✅ Groups list contains {len(data['groups'])} groups")


class TestAIGenerateCommandEndpoint:
    """Test /api/ai/generate-command endpoint"""

    def test_ai_generate_returns_200(self) -> None:
        """Test that AI generate command endpoint returns 200"""
        response = requests.post(
            f"{BASE_URL}/api/ai/generate-command",
            json={"description": "test komutu"},
            timeout=60,
        )
        assert response.status_code == 200
        print("✅ /api/ai/generate-command returned 200")

    def test_ai_generate_returns_code(self) -> None:
        """Test that AI generate returns code"""
        response = requests.post(
            f"{BASE_URL}/api/ai/generate-command",
            json={"description": "Merhaba diyen basit bir komut"},
            timeout=60,
        )
        data: dict = response.json()

        assert 'success' in data
        assert 'code' in data
        assert isinstance(data['code'], str)
        assert len(data['code']) > 0
        print(f"✅ AI generated code ({len(data['code'])} chars)")

    def test_ai_generate_requires_description(self) -> None:
        """Test that AI generate requires description"""
        response = requests.post(
            f"{BASE_URL}/api/ai/generate-command",
            json={},
            timeout=10,
        )
        assert response.status_code == 400
        print("✅ AI generate correctly rejects empty description")


class TestConfigEndpoint:
    """Test /api/config endpoint"""

    def test_config_returns_200(self) -> None:
        """Test that config endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/config", timeout=10)
        assert response.status_code == 200
        print("✅ /api/config returned 200")

    def test_config_returns_settings(self) -> None:
        """Test that config response contains settings"""
        response = requests.get(f"{BASE_URL}/api/config", timeout=10)
        data: dict = response.json()

        expected_fields = ['BOT_NAME', 'PREFIX', 'LANG']
        for field in expected_fields:
            assert field in data, f"Missing config field: {field}"
            print(f"✅ Config field '{field}': {data[field]}")


class TestPluginsEndpoint:
    """Test /api/plugins endpoint"""

    def test_plugins_returns_200(self) -> None:
        """Test that plugins endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/plugins", timeout=10)
        assert response.status_code == 200
        print("✅ /api/plugins returned 200")

    def test_plugins_returns_list(self) -> None:
        """Test that plugins response contains plugin list"""
        response = requests.get(f"{BASE_URL}/api/plugins", timeout=10)
        data: dict = response.json()

        assert 'success' in data
        assert 'plugins' in data
        assert isinstance(data['plugins'], list)
        print(f"✅ Plugins list contains {len(data['plugins'])} plugins")


class TestRuntimeStatsEndpoint:
    """Test /api/runtime-stats endpoint"""

    def test_runtime_stats_returns_200(self) -> None:
        """Test that runtime stats endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/runtime-stats", timeout=10)
        assert response.status_code == 200
        print("✅ /api/runtime-stats returned 200")

    def test_runtime_stats_returns_data(self) -> None:
        """Test that runtime stats contains expected fields"""
        response = requests.get(f"{BASE_URL}/api/runtime-stats", timeout=10)
        data: dict = response.json()

        expected_fields = ['totalMessages', 'totalCommands', 'activeUsers', 'managedGroups']
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"
            print(f"✅ Runtime stat '{field}': {data[field]}")


class TestTestProgressEndpoint:
    """Test /api/test-progress endpoint"""

    def test_test_progress_returns_200(self) -> None:
        """Test that test progress endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/test-progress", timeout=10)
        assert response.status_code == 200
        print("✅ /api/test-progress returned 200")

    def test_test_progress_returns_status(self) -> None:
        """Test that test progress contains status"""
        response = requests.get(f"{BASE_URL}/api/test-progress", timeout=10)
        data: dict = response.json()

        assert 'status' in data
        print(f"✅ Test progress status: {data['status']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
