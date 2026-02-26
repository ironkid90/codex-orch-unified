//! Utility functions for string processing and data manipulation
const std = @import("std");
const mem = @import("mem");
const ascii = @import("ascii");

// Constants for utility functions
pub const DEFAULT_BUFFER_SIZE: usize = 256;
pub const MAX_STRING_LENGTH: usize = 1024;

// Custom error types
pub const UtilError = error{
    BufferTooSmall,
    InvalidString,
    ProcessingFailed,
};

// String processing utilities
pub const StringProcessor = struct {
    buffer: []u8,
    allocator: std.mem.Allocator,
    
    pub fn init(allocator: std.mem.Allocator, buffer_size: usize) !StringProcessor {
        const buffer = try allocator.alloc(u8, buffer_size);
        return StringProcessor{
            .buffer = buffer,
            .allocator = allocator,
        };
    }
    
    pub fn deinit(self: *StringProcessor) void {
        self.allocator.free(self.buffer);
    }
    
    pub fn toUpperCase(self: *StringProcessor, input: []const u8) ![]const u8 {
        if (input.len > self.buffer.len) {
            return UtilError.BufferTooSmall;
        }
        
        for (input, 0..) |char, i| {
            self.buffer[i] = std.ascii.toUpper(char);
        }
        
        return self.buffer[0..input.len];
    }
    
    pub fn reverse(self: *StringProcessor, input: []const u8) ![]const u8 {
        if (input.len > self.buffer.len) {
            return UtilError.BufferTooSmall;
        }
        
        for (input, 0..) |char, i| {
            self.buffer[input.len - 1 - i] = char;
        }
        
        return self.buffer[0..input.len];
    }
};

// Data validation functions
pub fn validateEmail(email: []const u8) bool {
    if (email.len == 0) return false;
    
    var has_at = false;
    var has_dot = false;
    
    for (email) |char| {
        if (char == '@') {
            if (has_at) return false; // Multiple @ symbols
            has_at = true;
        } else if (char == '.') {
            has_dot = true;
        }
    }
    
    return has_at and has_dot;
}

pub fn isValidIdentifier(identifier: []const u8) bool {
    if (identifier.len == 0) return false;
    
    // First character must be letter or underscore
    if (!std.ascii.isAlphabetic(identifier[0]) and identifier[0] != '_') {
        return false;
    }
    
    // Rest must be alphanumeric or underscore
    for (identifier[1..]) |char| {
        if (!std.ascii.isAlphanumeric(char) and char != '_') {
            return false;
        }
    }
    
    return true;
}

// Simple string processing function used by main.zig
pub fn processData(input: []const u8) []const u8 {
    return if (input.len > 0) "Processed!" else "Empty input";
}

// Array utilities
pub fn findMax(numbers: []const i32) ?i32 {
    if (numbers.len == 0) return null;
    
    var max = numbers[0];
    for (numbers[1..]) |num| {
        if (num > max) {
            max = num;
        }
    }
    
    return max;
}

pub fn bubbleSort(numbers: []i32) void {
    const n = numbers.len;
    if (n <= 1) return;
    
    var i: usize = 0;
    while (i < n - 1) : (i += 1) {
        var j: usize = 0;
        while (j < n - i - 1) : (j += 1) {
            if (numbers[j] > numbers[j + 1]) {
                const temp = numbers[j];
                numbers[j] = numbers[j + 1];
                numbers[j + 1] = temp;
            }
        }
    }
}

// Tests
test "string processor initialization" {
    var processor = try StringProcessor.init(std.testing.allocator, 100);
    defer processor.deinit();
    
    const result = try processor.toUpperCase("hello");
    try std.testing.expectEqualStrings("HELLO", result);
}

test "email validation" {
    try std.testing.expect(validateEmail("test@example.com"));
    try std.testing.expect(!validateEmail("invalid-email"));
    try std.testing.expect(!validateEmail(""));
}

test "identifier validation" {
    try std.testing.expect(isValidIdentifier("valid_id"));
    try std.testing.expect(isValidIdentifier("_private"));
    try std.testing.expect(!isValidIdentifier("123invalid"));
    try std.testing.expect(!isValidIdentifier(""));
}

test "find maximum in array" {
    const numbers = [_]i32{ 3, 1, 4, 1, 5, 9, 2, 6 };
    const max = findMax(&numbers);
    try std.testing.expectEqual(@as(?i32, 9), max);
    
    const empty: []const i32 = &[_]i32{};
    try std.testing.expectEqual(@as(?i32, null), findMax(empty));
}

test "bubble sort" {
    var numbers = [_]i32{ 64, 34, 25, 12, 22, 11, 90 };
    bubbleSort(&numbers);
    
    const expected = [_]i32{ 11, 12, 22, 25, 34, 64, 90 };
    try std.testing.expectEqualSlices(i32, &expected, &numbers);
}