Feature: CV Parsing

  Scenario: Parse text CV extracts skills
    Given a CV text containing "React, Python, Docker"
    When the CV text is analyzed for skills
    Then skills should include "React"
    And skills should include "Python"

  Scenario: Empty CV gives low confidence
    Given an empty CV text
    When confidence is calculated
    Then confidence should be below 0.3

  Scenario: Completeness score with project details
    Given a conversation mentioning features and budget
    When completeness is calculated
    Then the score should be above 30
