#import <Foundation/Foundation.h>

@interface Person : NSObject

@property (nonatomic, strong) NSString *name;
@property (nonatomic, assign) NSInteger age;
@property (nonatomic, strong) NSString *email;

- (instancetype)initWithName:(NSString *)name age:(NSInteger)age;
- (void)sayHello;
- (void)updateEmail:(NSString *)email;
+ (Person *)createDefaultPerson;

@end