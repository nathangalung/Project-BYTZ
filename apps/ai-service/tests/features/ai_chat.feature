Feature: AI Chat Scoping
  As a project owner, I use the AI chatbot to scope my project
  so the platform can generate accurate BRD/PRD documents.

  Scenario: Chat requires project_id
    Given an empty chat request body
    When sent to the chat endpoint
    Then it should return 422

  Scenario: BRD generation requires conversation history
    Given a BRD generation request without conversation
    When sent to the generate-brd endpoint
    Then it should return 422

  Scenario: Health endpoint returns service info
    Given the AI service is running
    When the health endpoint is called
    Then it should return status "ok" and service "ai-service"

  Scenario: Completeness scoring for project scoping
    Given a conversation mentioning "fitur, target user, budget"
    When completeness is calculated
    Then the score should be above 30

  Scenario: Match-talents returns empty recommendations for new project
    Given a matching request for project "proj-new" with skills "React, Python"
    When sent to the match-talents endpoint
    Then the response should have 0 recommendations
