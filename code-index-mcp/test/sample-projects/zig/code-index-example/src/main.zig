const std = @import("std");
const builtin = @import("builtin");
const testing = @import("testing");
const code_index_example = @import("code_index_example");
const utils = @import("./utils.zig");
const math_utils = @import("./math.zig");

pub fn main() !void {
    // Prints to stderr, ignoring potential errors.
    std.debug.print("All your {s} are belong to us.\n", .{"codebase"});
    try code_index_example.bufferedPrint();
    
    // Test our custom utilities
    const result = utils.processData("Hello, World!");
    std.debug.print("Processed result: {s}\n", .{result});
    
    // Test math utilities
    const sum = math_utils.calculateSum(10, 20);
    std.debug.print("Sum: {}\n", .{sum});
    
    // Platform-specific code
    if (builtin.os.tag == .windows) {
        std.debug.print("Running on Windows\n", .{});
    } else {
        std.debug.print("Running on Unix-like system\n", .{});
    }
}

test "simple test" {
    var list = std.ArrayList(i32).init(std.testing.allocator);
    defer list.deinit(); // Try commenting this out and see if zig detects the memory leak!
    try list.append(42);
    try std.testing.expectEqual(@as(i32, 42), list.pop());
}

test "fuzz example" {
    const Context = struct {
        fn testOne(context: @This(), input: []const u8) anyerror!void {
            _ = context;
            // Try passing `--fuzz` to `zig build test` and see if it manages to fail this test case!
            try std.testing.expect(!std.mem.eql(u8, "canyoufindme", input));
        }
    };
    try std.testing.fuzz(Context{}, Context.testOne, .{});
}
