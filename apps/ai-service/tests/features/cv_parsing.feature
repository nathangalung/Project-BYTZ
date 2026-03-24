Feature: CV Parsing
  As the platform, I need to parse talent CVs so profiles are auto-filled
  with structured data including skills, education, and experience.

  Scenario: Parse a text-based CV
    Given a text CV with skills "React, Python, Docker"
    When the CV text is analyzed
    Then the extracted skills should include "React"
    And the confidence score should be above 0.3

  Scenario: Empty CV returns low confidence
    Given an empty CV text
    When the CV text is analyzed
    Then the confidence score should be below 0.1

  Scenario: CV with comprehensive information yields high confidence
    Given a comprehensive CV with name, email, skills, and experience
    When the CV text is analyzed
    Then the extracted name should not be empty
    And the extracted skills should have at least 3 items
    And the confidence score should be above 0.5

  Scenario: Skills are deduplicated across aliases
    Given a text CV with skills "reactjs, react, React"
    When the CV text is analyzed
    Then the skill "React" should appear exactly once

  Scenario: Portfolio URLs are extracted from CV
    Given a CV containing "https://github.com/user" and "https://linkedin.com/in/user"
    When the CV text is analyzed
    Then the extracted portfolio URLs should have 2 items
