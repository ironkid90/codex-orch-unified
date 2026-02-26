#import <Foundation/Foundation.h>
#import "Person.h"

@interface UserManager : NSObject

@property (nonatomic, strong) NSMutableArray<Person *> *users;

+ (UserManager *)sharedManager;
- (void)addUser:(Person *)user;
- (Person *)findUserByName:(NSString *)name;
- (void)removeUser:(Person *)user;
- (NSInteger)userCount;

@end