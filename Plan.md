# FrontDesk Catalog & Order Manager Implementation Plan

## Overview

This document defines the implementation plan for adding a **Catalog System** and **Order Management System** to FrontDesk.

The goal is to transform FrontDesk from a conversational automation platform into a complete AI-powered business assistant capable of:

- Understanding business products and services.
- Helping users discover products/services.
- Collecting order information.
- Creating and managing orders.
- Providing structured data access to external systems.

The Catalog and Order systems will be built together because they depend on each other.

---

# 1. Goals

## Catalog System Goals

- Store organisation-specific products and services.
- Provide structured business information to AI.
- Improve AI product/service identification.
- Allow users to get accurate product/service details.
- Support different business types.
- Support dynamic business-specific data.

## Order System Goals

- Collect order information through conversations.
- Create structured orders.
- Connect orders with catalog items.
- Store historical snapshots of ordered items.
- Support custom organisation workflows.
- Provide APIs for external systems.

---

# 2. High-Level Architecture

```
                         FrontDesk

                             |

                    Conversation Engine

                             |

                       Flow Runtime

                             |

              ┌──────────────┴──────────────┐

              |                             |

          Catalog                    Order Manager

              |                             |

     Products / Services                Orders

              |                             |

              └──────────────┬──────────────┘

                             |

                      MongoDB Atlas

                             |

                    External Systems
```

---

# 3. Multi Organisation Design

Both Catalog and Orders are organisation-specific.

Every document must contain:

```javascript
{
    organisationId: "ORG001"
}
```

## Rules

- Organisations cannot access each other's data.
- APIs must always verify organisation ownership.
- Future authentication layer should support API keys.

---

# 4. Catalog System

## 4.1 Purpose

The Catalog is the business knowledge layer of FrontDesk.

It provides:

- Product information.
- Service information.
- AI context.
- User-facing details.
- Order item references.

---

# 4.2 Catalog Item Types

Supported types:

```
product
service
```

Example:

```javascript
{
    type:"product"
}
```

or:

```javascript
{
    type:"service"
}
```

---

# 4.3 Dynamic Catalog Structure

Catalog fields must be fully dynamic.

Different businesses require different data.

## Product Example

```javascript
{
    organisationId:"ORG001",

    type:"product",

    fields:{
        name:"Fresh Milk 500ml",
        price:180,
        category:"Dairy",
        size:"500ml"
    }
}
```

## Service Example

```javascript
{
    organisationId:"ORG001",

    type:"service",

    fields:{
        name:"Hair Cut",
        duration:"30 minutes",
        price:1500
    }
}
```

---

# 4.4 Catalog Item Relationships

Catalog supports:

- Variants.
- Options.

Example:

```javascript
{
    fields:{
        name:"T-Shirt",

        variants:[
            {
                name:"Size",

                values:[
                    "S",
                    "M",
                    "L"
                ]
            },

            {
                name:"Color",

                values:[
                    "Red",
                    "Blue"
                ]
            }
        ]
    }
}
```

---

# 4.5 Catalog Status System

Each organisation can define custom statuses.

## Example: Restaurant

```
available
out_of_stock
seasonal
discontinued
```

## Example: Service Business

```
available
fully_booked
closed
```

Stored:

```javascript
{
    status:"available"
}
```

---

# 4.6 Catalog MongoDB Collection

Collection:

```
catalogItems
```

Example:

```javascript
{
    _id:ObjectId(),

    organisationId:"ORG001",

    type:"product",

    fields:{
        name:"Milk Bottle",
        price:180
    },

    status:"available",

    createdAt:Date,

    updatedAt:Date
}
```

---

# 5. Catalog AI Integration

## 5.1 AI Context

AI receives the complete organisation catalog.

Every AI request:

```
User Message

+

Conversation Context

+

Flow Context

+

Full Organisation Catalog

        |

        ▼

     API Router

        |

        ▼

        AI Model
```

---

## 5.2 Catalog Refresh

Phase 1:

- No caching.
- Fetch latest catalog from MongoDB Atlas on every AI request.

Flow:

```
Admin updates catalog

        |

        ▼

MongoDB Updated

        |

        ▼

Next AI Request

        |

        ▼

Latest Catalog Used
```

---

# 6. AI Catalog Matching

Purpose:

Identify products/services from natural language.

Example:

User:

```
I need two milk bottles
```

AI receives:

```
Milk 250ml
Milk 500ml
Chocolate Milk
```

AI returns:

```json
{
    "itemId":"MILK500",
    "quantity":2
}
```

---

# 6.1 Uncertainty Handling

If AI confidence is low:

Example:

User:

```
I need a premium phone
```

Possible matches:

```
Samsung Galaxy
iPhone Pro
```

Bot:

```
Which one do you mean?
```

---

# 7. Order Manager

## 7.1 Purpose

Order Manager stores customer transactions created through FrontDesk conversations.

---

# 7.2 Order Creation Flow

Orders are created only when the **Place Order Block** executes.

```
User Conversation

        |

        ▼

Collect Data

        |

        ▼

Flow Variables

        |

        ▼

User Confirmation

        |

        ▼

Place Order Block

        |

        ▼

Order Manager

        |

        ▼

MongoDB Atlas
```

---

# 7.3 Order Structure

Orders contain:

## Fixed Core Fields

```javascript
{
    orderId,

    organisationId,

    customerId,

    status,

    createdAt,

    updatedAt
}
```

---

## Custom Fields

Defined by organisation.

Example:

```javascript
{
    customerName:"Nimal",

    address:"Colombo",

    notes:"Call before delivery"
}
```

---

# 7.4 Order Items

Order items store:

- Catalog item ID.
- Product/service snapshot.
- Quantity.

Example:

```javascript
{
    itemId:"MILK500",

    snapshot:{
        name:"Milk 500ml",
        price:180
    },

    quantity:2
}
```

## Reason

Snapshots ensure:

- Catalog changes do not affect old orders.
- Historical accuracy is maintained.

---

# 7.5 Order Status System

Custom statuses per organisation.

Example:

```
received
preparing
ready
delivered
cancelled
```

Stored:

```javascript
{
    status:"received"
}
```

---

# 7.6 Order History

Every order change must be tracked.

Collection:

```
orderHistory
```

Example:

```javascript
{
    orderId:"ORD001",

    changes:[
        {
            field:"status",

            oldValue:"received",

            newValue:"preparing",

            source:"flow",

            timestamp:Date
        }
    ]
}
```

Sources:

- Flow Manager.
- Admin dashboard.
- External APIs.
- AI operations.

---

# 8. Flow Manager Integration

## 8.1 Catalog Selector Block

Purpose:

Allow users to select catalog items.

Example:

```
Catalog Selector

Catalog:
Products

Save To:
items
```

Output:

```javascript
{
    items:[
        {
            itemId:"PRODUCT001"
        }
    ]
}
```

---

# 8.2 Array Manager Block

Purpose:

Manage array variables.

Operations:

```
Add
Edit
Delete
Clear
```

Example:

```javascript
items.push({

    itemId:"PRODUCT001",

    quantity:2

})
```

---

# 8.3 Place Order Block

Purpose:

Create the final order.

Input:

```
Order Variables
```

Process:

```
Place Order Block

        |

        ▼

Order Manager

        |

        ▼

Create Order

        |

        ▼

Return Order ID
```

---

# 9. Variable Integration

Example:

```javascript
{
    customerName:"",

    address:"",

    items:[]
}
```

Catalog selection:

```javascript
{
    items:[
        {
            itemId:"ITEM001"
        }
    ]
}
```

---

# 10. API Design

## 10.1 Catalog API

Designed for external systems.

Future endpoints:

```
GET    /api/catalog/items

GET    /api/catalog/items/:id

POST   /api/catalog/items

PUT    /api/catalog/items/:id

DELETE /api/catalog/items/:id
```

Authentication:

- API Key system.
- Organisation permission checks.

---

## 10.2 Order API

Future endpoints:

```
GET    /api/orders

GET    /api/orders/:id

POST   /api/orders

PUT    /api/orders/:id
```

---

# 11. Implementation Phases

## Phase 1 - Database and Core Services

Create:

```
services/catalog/

services/orders/
```

Implement:

- MongoDB models.
- CRUD services.
- Organisation isolation.

---

## Phase 2 - Admin Management

Create:

- Catalog management UI.
- Order management UI.
- Custom status configuration.

---

## Phase 3 - Flow Manager Integration

Create:

- Catalog Selector Block.
- Array Manager Block.
- Place Order Block.

---

## Phase 4 - AI Integration

Implement:

- Catalog context injection.
- Product/service matching.
- Confirmation handling.
- Order extraction.

---

## Phase 5 - External APIs

Implement:

- Public catalog APIs.
- Public order APIs.
- API authentication.

---

# Future Improvements

Possible future features:

- Inventory management.
- Payment tracking.
- Delivery tracking.
- Product recommendations.
- Discounts.
- Customer-specific pricing.
- Semantic catalog search.
- AI shopping assistant.
- Automatic quotation generation.

---

# Final Architecture

```
                         FrontDesk

                             |

                    Conversation Engine

                             |

                      Flow Runtime

                             |

          ┌──────────────────┴──────────────────┐

          |                                     |

      Catalog                           Order Manager

          |                                     |

 Products / Services                      Orders

          |                                     |

          └──────────────────┬──────────────────┘

                             |

                      MongoDB Atlas

                             |

                    External Systems
```