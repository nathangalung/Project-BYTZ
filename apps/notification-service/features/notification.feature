Feature: Notification Delivery

  Scenario: Create notification for user
    Given a user with ID "user-1"
    When a project_match notification is created
    Then the notification should be stored
    And it should be marked as unread

  Scenario: Mark notification as read
    Given an unread notification for user "user-1"
    When the user marks it as read
    Then it should be marked as read

  Scenario: List notifications with pagination
    Given 25 notifications for user "user-1"
    When requesting page 1 with pageSize 10
    Then 10 notifications should be returned
    And total should be 25

  Scenario: Create notification validates required fields
    Given the notification service is running
    When a notification is created without userId
    Then it should return a validation error

  Scenario: Unread count returns correct number
    Given 5 unread notifications for user "user-2"
    When requesting unread count
    Then unread count should be 5
