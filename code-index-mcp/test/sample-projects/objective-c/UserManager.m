#import "UserManager.h"

@implementation UserManager

+ (UserManager *)sharedManager {
    static UserManager *sharedInstance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        sharedInstance = [[UserManager alloc] init];
        sharedInstance.users = [[NSMutableArray alloc] init];
    });
    return sharedInstance;
}

- (void)addUser:(Person *)user {
    if (user) {
        [self.users addObject:user];
        NSLog(@"Added user: %@", user.name);
    }
}

- (Person *)findUserByName:(NSString *)name {
    for (Person *user in self.users) {
        if ([user.name isEqualToString:name]) {
            return user;
        }
    }
    return nil;
}

- (void)removeUser:(Person *)user {
    if (user) {
        [self.users removeObject:user];
        NSLog(@"Removed user: %@", user.name);
    }
}

- (NSInteger)userCount {
    return self.users.count;
}

@end