Feature: AI Service Endpoints

  Scenario: Health endpoint returns ok
    Given the AI service is running
    When I call GET /health
    Then response status should be 200
    And response body should contain "ok"

  Scenario: Chat requires project_id
    Given an empty chat request body
    When I call POST /api/v1/ai/chat
    Then response status should be 422

  Scenario: BRD generation requires conversation
    Given an empty BRD request body
    When I call POST /api/v1/ai/generate-brd
    Then response status should be 422
