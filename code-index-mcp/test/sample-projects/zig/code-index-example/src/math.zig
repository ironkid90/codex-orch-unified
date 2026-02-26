//! Mathematical utility functions and data structures
const std = @import("std");
const math = @import("math");
const testing = @import("testing");

// Mathematical constants
pub const PI: f64 = 3.14159265358979323846;
pub const E: f64 = 2.71828182845904523536;
pub const GOLDEN_RATIO: f64 = 1.61803398874989484820;

// Complex number representation
pub const Complex = struct {
    real: f64,
    imag: f64,
    
    pub fn init(real: f64, imag: f64) Complex {
        return Complex{ .real = real, .imag = imag };
    }
    
    pub fn add(self: Complex, other: Complex) Complex {
        return Complex{
            .real = self.real + other.real,
            .imag = self.imag + other.imag,
        };
    }
    
    pub fn multiply(self: Complex, other: Complex) Complex {
        return Complex{
            .real = self.real * other.real - self.imag * other.imag,
            .imag = self.real * other.imag + self.imag * other.real,
        };
    }
    
    pub fn magnitude(self: Complex) f64 {
        return @sqrt(self.real * self.real + self.imag * self.imag);
    }
    
    pub fn conjugate(self: Complex) Complex {
        return Complex{ .real = self.real, .imag = -self.imag };
    }
};

// Point in 2D space
pub const Point2D = struct {
    x: f64,
    y: f64,
    
    pub fn init(x: f64, y: f64) Point2D {
        return Point2D{ .x = x, .y = y };
    }
    
    pub fn distance(self: Point2D, other: Point2D) f64 {
        const dx = self.x - other.x;
        const dy = self.y - other.y;
        return @sqrt(dx * dx + dy * dy);
    }
    
    pub fn midpoint(self: Point2D, other: Point2D) Point2D {
        return Point2D{
            .x = (self.x + other.x) / 2.0,
            .y = (self.y + other.y) / 2.0,
        };
    }
};

// Statistics utilities
pub const Statistics = struct {
    pub fn mean(values: []const f64) f64 {
        if (values.len == 0) return 0.0;
        
        var sum: f64 = 0.0;
        for (values) |value| {
            sum += value;
        }
        
        return sum / @as(f64, @floatFromInt(values.len));
    }
    
    pub fn median(values: []const f64, buffer: []f64) f64 {
        if (values.len == 0) return 0.0;
        
        // Copy to buffer and sort
        for (values, 0..) |value, i| {
            buffer[i] = value;
        }
        std.sort.insertionSort(f64, buffer[0..values.len], {}, std.sort.asc(f64));
        
        const n = values.len;
        if (n % 2 == 1) {
            return buffer[n / 2];
        } else {
            return (buffer[n / 2 - 1] + buffer[n / 2]) / 2.0;
        }
    }
    
    pub fn standardDeviation(values: []const f64) f64 {
        if (values.len <= 1) return 0.0;
        
        const avg = mean(values);
        var sum_sq_diff: f64 = 0.0;
        
        for (values) |value| {
            const diff = value - avg;
            sum_sq_diff += diff * diff;
        }
        
        return @sqrt(sum_sq_diff / @as(f64, @floatFromInt(values.len - 1)));
    }
};

// Basic math functions
pub fn factorial(n: u32) u64 {
    if (n <= 1) return 1;
    return @as(u64, n) * factorial(n - 1);
}

pub fn fibonacci(n: u32) u64 {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
}

pub fn gcd(a: u32, b: u32) u32 {
    if (b == 0) return a;
    return gcd(b, a % b);
}

pub fn lcm(a: u32, b: u32) u32 {
    return (a * b) / gcd(a, b);
}

pub fn isPrime(n: u32) bool {
    if (n < 2) return false;
    if (n == 2) return true;
    if (n % 2 == 0) return false;
    
    var i: u32 = 3;
    while (i * i <= n) : (i += 2) {
        if (n % i == 0) return false;
    }
    
    return true;
}

// Function used by main.zig
pub fn calculateSum(a: i32, b: i32) i32 {
    return a + b;
}

pub fn power(base: f64, exponent: i32) f64 {
    if (exponent == 0) return 1.0;
    if (exponent < 0) return 1.0 / power(base, -exponent);
    
    var result: f64 = 1.0;
    var exp = exponent;
    var b = base;
    
    while (exp > 0) {
        if (exp % 2 == 1) {
            result *= b;
        }
        b *= b;
        exp /= 2;
    }
    
    return result;
}

// Matrix operations (2x2 for simplicity)
pub const Matrix2x2 = struct {
    data: [2][2]f64,
    
    pub fn init(a: f64, b: f64, c: f64, d: f64) Matrix2x2 {
        return Matrix2x2{
            .data = [_][2]f64{
                [_]f64{ a, b },
                [_]f64{ c, d },
            },
        };
    }
    
    pub fn multiply(self: Matrix2x2, other: Matrix2x2) Matrix2x2 {
        return Matrix2x2{
            .data = [_][2]f64{
                [_]f64{
                    self.data[0][0] * other.data[0][0] + self.data[0][1] * other.data[1][0],
                    self.data[0][0] * other.data[0][1] + self.data[0][1] * other.data[1][1],
                },
                [_]f64{
                    self.data[1][0] * other.data[0][0] + self.data[1][1] * other.data[1][0],
                    self.data[1][0] * other.data[0][1] + self.data[1][1] * other.data[1][1],
                },
            },
        };
    }
    
    pub fn determinant(self: Matrix2x2) f64 {
        return self.data[0][0] * self.data[1][1] - self.data[0][1] * self.data[1][0];
    }
};

// Tests
test "complex number operations" {
    const z1 = Complex.init(3.0, 4.0);
    const z2 = Complex.init(1.0, 2.0);
    
    const sum = z1.add(z2);
    try std.testing.expectEqual(@as(f64, 4.0), sum.real);
    try std.testing.expectEqual(@as(f64, 6.0), sum.imag);
    
    const magnitude = z1.magnitude();
    try std.testing.expectApproxEqAbs(@as(f64, 5.0), magnitude, 0.0001);
}

test "point distance calculation" {
    const p1 = Point2D.init(0.0, 0.0);
    const p2 = Point2D.init(3.0, 4.0);
    
    const dist = p1.distance(p2);
    try std.testing.expectApproxEqAbs(@as(f64, 5.0), dist, 0.0001);
}

test "factorial calculation" {
    try std.testing.expectEqual(@as(u64, 1), factorial(0));
    try std.testing.expectEqual(@as(u64, 1), factorial(1));
    try std.testing.expectEqual(@as(u64, 120), factorial(5));
}

test "fibonacci sequence" {
    try std.testing.expectEqual(@as(u64, 0), fibonacci(0));
    try std.testing.expectEqual(@as(u64, 1), fibonacci(1));
    try std.testing.expectEqual(@as(u64, 13), fibonacci(7));
}

test "prime number detection" {
    try std.testing.expect(isPrime(2));
    try std.testing.expect(isPrime(17));
    try std.testing.expect(!isPrime(4));
    try std.testing.expect(!isPrime(1));
}

test "statistics calculations" {
    const values = [_]f64{ 1.0, 2.0, 3.0, 4.0, 5.0 };
    
    const avg = Statistics.mean(&values);
    try std.testing.expectEqual(@as(f64, 3.0), avg);
    
    var buffer: [10]f64 = undefined;
    const med = Statistics.median(&values, &buffer);
    try std.testing.expectEqual(@as(f64, 3.0), med);
}

test "matrix operations" {
    const m1 = Matrix2x2.init(1.0, 2.0, 3.0, 4.0);
    const m2 = Matrix2x2.init(5.0, 6.0, 7.0, 8.0);
    
    const product = m1.multiply(m2);
    try std.testing.expectEqual(@as(f64, 19.0), product.data[0][0]);
    try std.testing.expectEqual(@as(f64, 22.0), product.data[0][1]);
    
    const det = m1.determinant();
    try std.testing.expectEqual(@as(f64, -2.0), det);
}