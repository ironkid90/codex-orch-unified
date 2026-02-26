#import "Person.h"

@implementation Person

- (instancetype)initWithName:(NSString *)name age:(NSInteger)age {
    self = [super init];
    if (self) {
        _name = name;
        _age = age;
    }
    return self;
}

- (void)sayHello {
    NSLog(@"Hello, my name is %@", self.name);
}

- (void)updateEmail:(NSString *)email {
    self.email = email;
    NSLog(@"Email updated to: %@", email);
}

+ (Person *)createDefaultPerson {
    return [[Person alloc] initWithName:@"John Doe" age:30];
}

@end