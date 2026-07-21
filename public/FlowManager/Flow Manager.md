The Flow Manager is a page where it helps to understand the conversations and the flows of the conversation flow of a chat.

It provides info on:
- how to great the user
- what to do next 
- how to end the conversation
- what are the avalabe options
- what are the expected user inputs
- how to handle unexpected user inputs
- fetch data from which files and when to fetch data 

Flow Manager should have the following files:
- flowManager.html
- style.css
- scripts.js

frontend:
- match the theme of the application
- A large canvas in the middle where all the elements are placed
- elements could be draged from a menu in left and dropped on the canvas
- A veriables pannel should be added on the right side where it shows all the veriables and let user to create a new variable.
- connect the elements with lines 
- user should be able to freely scroll, move, zoom in/out the canvas
- elements should be moveable
- A start element should pre-added to the canvas

menu list:
- say(): This element is used to send a message to the user.
- get(variableName): This element is used to fetch data from the user respond (Text) and store it in a variable. (use AI to fetch the proper data)
- getOption(optionsList): This element is used to get an option from the user and store it in a variable. each option should have a line connection point (use AI to match the users respond with the options list)
- wait(): This element is used to wait for a certain amount of time.
- triggerIf(event): This element is used to trigger a flow based on an event.

backend suggestions:
- create a new MongoDB schema/model `Flow` to store nodes, edges, and variables for each account.
- add express routes in `routes/` (e.g. `routes/flow.js`) for CRUD operations on flows:
  - `GET /api/flow/:accountId` to retrieve the saved flow.
  - `POST /api/flow/:accountId` to save/update the flow state.
- modify the WhatsApp bot message handler to parse the current state of the user in the flow and determine the next node based on incoming messages, instead of purely relying on `say` or AI configurations.
