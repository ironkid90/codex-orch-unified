//! By convention, root.zig is the root source file when making a library.
const std = @import("std");
const fmt = @import("fmt");
const mem = @import("mem");
const json = @import("json");

// Define custom types and structures
pub const Config = struct {
    name: []const u8,
    version: u32,
    debug: bool,
    
    pub fn init(name: []const u8, version: u32) Config {
        return Config{
            .name = name,
            .version = version,
            .debug = false,
        };
    }
    
    pub fn setDebug(self: *Config, debug: bool) void {
        self.debug = debug;
    }
};

pub const ErrorType = enum {
    None,
    InvalidInput,
    OutOfMemory,
    NetworkError,
    
    pub fn toString(self: ErrorType) []const u8 {
        return switch (self) {
            .None => "No error",
            .InvalidInput => "Invalid input",
            .OutOfMemory => "Out of memory",
            .NetworkError => "Network error",
        };
    }
};

// Global constants
pub const VERSION: u32 = 1;
pub const MAX_BUFFER_SIZE: usize = 4096;
var global_config: Config = undefined;

pub fn bufferedPrint() !void {
    // Stdout is for the actual output of your application, for example if you
    // are implementing gzip, then only the compressed bytes should be sent to
    // stdout, not any debugging messages.
    var stdout_buffer: [1024]u8 = undefined;
    var stdout_writer = std.fs.File.stdout().writer(&stdout_buffer);
    const stdout = &stdout_writer.interface;

    try stdout.print("Run `zig build test` to run the tests.\n", .{});

    try stdout.flush(); // Don't forget to flush!
}

pub fn add(a: i32, b: i32) i32 {
    return a + b;
}

pub fn multiply(a: i32, b: i32) i32 {
    return a * b;
}

pub fn processConfig(config: *const Config) !void {
    std.debug.print("Processing config: {s} v{}\n", .{ config.name, config.version });
    if (config.debug) {
        std.debug.print("Debug mode enabled\n", .{});
    }
}

pub fn handleError(err: ErrorType) void {
    std.debug.print("Error: {s}\n", .{err.toString()});
}

// Advanced function with error handling
pub fn parseNumber(input: []const u8) !i32 {
    if (input.len == 0) {
        return error.InvalidInput;
    }
    
    return std.fmt.parseInt(i32, input, 10) catch |err| switch (err) {
        error.InvalidCharacter => error.InvalidInput,
        error.Overflow => error.OutOfMemory,
        else => err,
    };
}

// Generic function
pub fn swap(comptime T: type, a: *T, b: *T) void {
    const temp = a.*;
    a.* = b.*;
    b.* = temp;
}

test "basic add functionality" {
    try std.testing.expect(add(3, 7) == 10);
}

test "config initialization" {
    var config = Config.init("test-app", 1);
    try std.testing.expectEqualStrings("test-app", config.name);
    try std.testing.expectEqual(@as(u32, 1), config.version);
    try std.testing.expectEqual(false, config.debug);
    
    config.setDebug(true);
    try std.testing.expectEqual(true, config.debug);
}

test "error type handling" {
    const err = ErrorType.InvalidInput;
    try std.testing.expectEqualStrings("Invalid input", err.toString());
}

test "number parsing" {
    const result = try parseNumber("42");
    try std.testing.expectEqual(@as(i32, 42), result);
    
    // Test error case
    const invalid_result = parseNumber("");
    try std.testing.expectError(error.InvalidInput, invalid_result);
}

test "generic swap function" {
    var a: i32 = 10;
    var b: i32 = 20;
    
    swap(i32, &a, &b);
    
    try std.testing.expectEqual(@as(i32, 20), a);
    try std.testing.expectEqual(@as(i32, 10), b);
}
