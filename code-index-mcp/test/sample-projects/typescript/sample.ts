/**
 * Sample TypeScript file for testing Code Index MCP analysis.
 */

interface PersonInterface {
    name: string;
    age: number;
    email?: string;
}

interface UserManagerInterface {
    addUser(person: Person): void;
    findByName(name: string): Person | null;
    getAllUsers(): Person[];
    getUserCount(): number;
}

/**
 * Represents a person with basic information.
 */
class Person implements PersonInterface {
    public readonly name: string;
    public readonly age: number;
    public email?: string;
    
    constructor(name: string, age: number, email?: string) {
        if (age < 0) {
            throw new Error("Age cannot be negative");
        }
        
        this.name = name;
        this.age = age;
        this.email = email;
    }
    
    /**
     * Returns a greeting message.
     */
    greet(): string {
        return `Hello, I'm ${this.name} and I'm ${this.age} years old.`;
    }
    
    /**
     * Update the person's email.
     */
    updateEmail(email: string): void {
        this.email = email;
    }
    
    /**
     * Create a Person from an object.
     */
    static fromObject(data: PersonInterface): Person {
        return new Person(data.name, data.age, data.email);
    }
    
    /**
     * Convert person to JSON-serializable object.
     */
    toJSON(): PersonInterface {
        return {
            name: this.name,
            age: this.age,
            email: this.email
        };
    }
}

/**
 * Generic utility type for filtering arrays.
 */
type FilterFunction<T> = (item: T) => boolean;

/**
 * Manages a collection of users.
 */
class UserManager implements UserManagerInterface {
    private users: Person[] = [];
    
    /**
     * Add a user to the collection.
     */
    addUser(person: Person): void {
        this.users.push(person);
    }
    
    /**
     * Find a user by name.
     */
    findByName(name: string): Person | null {
        const user = this.users.find(user => user.name === name);
        return user || null;
    }
    
    /**
     * Get all users.
     */
    getAllUsers(): Person[] {
        return [...this.users];
    }
    
    /**
     * Filter users by a custom function.
     */
    filterUsers(filterFn: FilterFunction<Person>): Person[] {
        return this.users.filter(filterFn);
    }
    
    /**
     * Get users older than specified age.
     */
    getUsersOlderThan(age: number): Person[] {
        return this.filterUsers(user => user.age > age);
    }
    
    /**
     * Get users with email addresses.
     */
    getUsersWithEmail(): Person[] {
        return this.filterUsers(user => !!user.email);
    }
    
    /**
     * Get the number of users.
     */
    getUserCount(): number {
        return this.users.length;
    }
    
    /**
     * Export all users as JSON.
     */
    exportToJSON(): string {
        return JSON.stringify(this.users.map(user => user.toJSON()), null, 2);
    }
}

/**
 * Utility functions for working with users.
 */
namespace UserUtils {
    export function validateAge(age: number): boolean {
        return age >= 0 && age <= 150;
    }
    
    export function formatUserList(users: Person[]): string {
        return users.map(user => user.greet()).join('\n');
    }
    
    export const DEFAULT_USERS: PersonInterface[] = [
        { name: "Alice", age: 30, email: "alice@example.com" },
        { name: "Bob", age: 25 },
        { name: "Charlie", age: 35, email: "charlie@example.com" }
    ];
}

/**
 * Main function to demonstrate usage.
 */
function main(): void {
    const manager = new UserManager();
    
    // Add some users
    UserUtils.DEFAULT_USERS.forEach(userData => {
        const person = Person.fromObject(userData);
        manager.addUser(person);
        console.log(person.greet());
    });
    
    console.log(`Total users: ${manager.getUserCount()}`);
    
    // Find users older than 25
    const olderUsers = manager.getUsersOlderThan(25);
    console.log(`Users older than 25: ${olderUsers.length}`);
    
    // Export to JSON
    console.log("Users as JSON:");
    console.log(manager.exportToJSON());
}

// Export for module usage
export { Person, UserManager, UserUtils, PersonInterface, UserManagerInterface };

// Run main if this is the entry point
if (require.main === module) {
    main();
}