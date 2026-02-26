#import <Foundation/Foundation.h>
#import "Person.h"
#import "UserManager.h"

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        // Create some users
        Person *alice = [[Person alloc] initWithName:@"Alice" age:25];
        Person *bob = [[Person alloc] initWithName:@"Bob" age:30];
        Person *charlie = [Person createDefaultPerson];
        
        // Get shared manager
        UserManager *manager = [UserManager sharedManager];
        
        // Add users
        [manager addUser:alice];
        [manager addUser:bob];
        [manager addUser:charlie];
        
        // Find user
        Person *found = [manager findUserByName:@"Alice"];
        if (found) {
            [found sayHello];
            [found updateEmail:@"alice@example.com"];
        }
        
        NSLog(@"Total users: %ld", (long)[manager userCount]);
    }
    return 0;
}